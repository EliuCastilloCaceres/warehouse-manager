// Transformador de ts-jest: los tests compilan a CommonJS (decisión de F0), donde
// `import.meta` no existe. Reemplaza `import.meta.url` por su equivalente en CJS.
// Solo afecta a Jest; la API compilada y tsx siguen usando ESM.
const ts = require('typescript');

module.exports = {
  name: 'import-meta-url-to-cjs',
  version: 1,
  factory() {
    return (context) => {
      const { factory } = context;
      const visit = (node) => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isMetaProperty(node.expression) &&
          node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
          node.name.text === 'url'
        ) {
          // require('node:url').pathToFileURL(__filename).href
          return factory.createPropertyAccessExpression(
            factory.createCallExpression(
              factory.createPropertyAccessExpression(
                factory.createCallExpression(factory.createIdentifier('require'), undefined, [
                  factory.createStringLiteral('node:url'),
                ]),
                'pathToFileURL',
              ),
              undefined,
              [factory.createIdentifier('__filename')],
            ),
            'href',
          );
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (sourceFile) => ts.visitNode(sourceFile, visit);
    };
  },
};
