import importlib.util
import json
import pathlib
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('engine_runner', ROOT / 'scripts/experiments/stereo/run.py')
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class EngineBundleTest(unittest.TestCase):
    def setUp(self):
        (ROOT / 'build').mkdir(exist_ok=True)
        directory = tempfile.TemporaryDirectory(prefix='engine-bundle-test-', dir=ROOT / 'build')
        self.addCleanup(directory.cleanup)
        self.root = pathlib.Path(directory.name)
        self.work = self.root / 'build/stereo-gate'
        self.source = self.work / 'source' / runner.SOURCE_NAME
        self.wrapper = self.source / 'libsidplayfp-wasm'
        self.output = self.work / 'output'
        self.wrapper.mkdir(parents=True)
        self.output.mkdir()
        self.metadata = {
            'EXPLORER-REBUILD.md': (self.source / 'EXPLORER-REBUILD.md', b'Rebuild instructions.\n', 0o640),
            'EXPLORER-LICENSE.txt': (self.root / 'LICENSE', b'Explorer license.\n', 0o644),
            'MODIFICATIONS.md': (self.wrapper / 'MODIFICATIONS.md', b'Raw-chip modifications.\n', 0o644),
        }
        for name, (source, content, mode) in self.metadata.items():
            source.write_bytes(content)
            source.chmod(mode)
            destination = self.output / name
            destination.write_bytes(b'Previous metadata.\n')
            destination.chmod(0o444)
        self.runtime = {name: f'Unchanged compiled artifact: {name}'.encode() for name in [
            'libsidplayfp.js', 'libsidplayfp.wasm', 'libsidplayfp.d.ts', 'LICENSE', 'THIRD-PARTY-NOTICES.md',
        ]}
        for name, content in self.runtime.items():
            (self.output / name).write_bytes(content)
        (self.work / 'image.id').write_text('sha256:fixture-image\n')
        (self.wrapper / 'upstream.json').write_text('{"fixture":"pinned upstream"}')
        environment = patch.multiple(runner, ROOT=self.root, WORK=self.work, SOURCE=self.source, WRAPPER=self.wrapper, OUTPUT=self.output)
        environment.start()
        self.addCleanup(environment.stop)

    def test_bundle_replaces_read_only_metadata_and_preserves_runtime(self):
        for name in self.metadata:
            with self.assertRaises(PermissionError):
                (self.output / name).open('wb')
        runner.bundle()
        for name, (_, content, mode) in self.metadata.items():
            self.assertEqual((self.output / name).read_bytes(), content)
            self.assertEqual(stat.S_IMODE((self.output / name).stat().st_mode), mode)
        for name, content in self.runtime.items():
            self.assertEqual((self.output / name).read_bytes(), content)
        receipt = json.loads((self.output / 'provenance.json').read_text())
        self.assertEqual(receipt['buildRunnerSha256'], runner.digest(runner.HERE / 'run.py'))
        for artifact in receipt['files']:
            path = self.output / artifact['file']
            self.assertEqual(artifact['bytes'], path.stat().st_size)
            self.assertEqual(artifact['sha256'], runner.digest(path))
        with tarfile.open(self.output / 'complete-source.tar.gz') as archive:
            self.assertEqual(archive.extractfile(f'{runner.SOURCE_NAME}/explorer-stereo-gate/run.py').read(),
                             (runner.HERE / 'run.py').read_bytes())
            self.assertEqual(archive.extractfile(f'{runner.SOURCE_NAME}/libsidplayfp-wasm/MODIFICATIONS.md').read(),
                             self.metadata['MODIFICATIONS.md'][1])
        self.assertFalse(list(self.output.glob('.*')))

    def test_missing_source_preserves_existing_artifact_without_receipt(self):
        self.metadata['EXPLORER-REBUILD.md'][0].unlink()
        before = {path.name: path.read_bytes() for path in self.output.iterdir()}
        with self.assertRaises(FileNotFoundError):
            runner.bundle()
        self.assertEqual({path.name: path.read_bytes() for path in self.output.iterdir()}, before)
        self.assertEqual(stat.S_IMODE((self.output / 'EXPLORER-REBUILD.md').stat().st_mode), 0o444)

    def test_incomplete_copy_preserves_existing_artifact_without_receipt(self):
        before = {path.name: path.read_bytes() for path in self.output.iterdir()}

        def fail_copy(source, destination):
            pathlib.Path(destination).write_bytes(b'Incomplete metadata')
            raise OSError('Injected copy failure')

        with patch.object(runner.shutil, 'copy2', side_effect=fail_copy):
            with self.assertRaisesRegex(OSError, 'Injected copy failure'):
                runner.bundle()
        self.assertEqual({path.name: path.read_bytes() for path in self.output.iterdir()}, before)
        self.assertEqual(stat.S_IMODE((self.output / 'EXPLORER-REBUILD.md').stat().st_mode), 0o444)


if __name__ == '__main__':
    unittest.main()
