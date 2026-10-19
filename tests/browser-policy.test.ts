import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import ts from 'typescript';

test('browser tests synchronize on state and centralize worker interception', () => {
  const violations: string[] = [];
  for (const name of readdirSync('tests/browser').filter(name => name.endsWith('.ts'))) {
    const source = ts.createSourceFile(name, readFileSync(`tests/browser/${name}`, 'utf8'), ts.ScriptTarget.Latest, true);
    const report = (node: ts.Node, reason: string) => violations.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${reason}`);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : '';
        const testBudget = ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'test' && callee === 'setTimeout';
        if (['setTimeout', 'waitForTimeout'].includes(callee) && !testBudget) report(node, 'Use observable progress or holdWorkerRequest; fixed-delay synchronization races the runner.');
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'postMessage' && name !== 'worker-control.ts') {
        report(node, 'Keep worker interception in worker-control.ts.');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, []);
});
