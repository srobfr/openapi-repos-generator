import { Schema } from "./types.ts";

type ImportDef = {
  symbol: string;
  alias?: string;
  path: string;
  isDefault: boolean;
};

export const importsBy: WeakMap<any, Array<ImportDef>> = new WeakMap();

export function addImportBy(
  key: any,
  symbol: ImportDef["symbol"],
  path: ImportDef["path"],
  isDefault: ImportDef["isDefault"] = false,
  alias?: ImportDef["alias"],
) {
  if (!importsBy.has(key)) importsBy.set(key, []);
  importsBy.get(key)?.push({ symbol, path, alias, isDefault });
  return ""; // So we can use this in template strings ;)
}

const importPathSortKey = (path: string) => path.replace(/^~/, '');

export function buildImports(keys: Array<any>, excludePath?: string): string {
  const importsDefs = keys.map((key) => (importsBy.get(key) ?? [])).flat();

  const importsByPath: { [path: string]: { [symbol: string]: ImportDef } } = {};
  for (const importDef of importsDefs) {
    (importsByPath[importDef.path] ??= {})[
      importDef.isDefault ? "_default" : importDef.symbol
    ] = importDef;
  }

  const withAlias = (importDef: ImportDef) =>
    `${importDef.symbol}${importDef.alias ? ` as ${importDef.alias}` : ""}`;

  const codeLines = [];
  const sortedEntries = Object
    .entries(importsByPath)
    .sort((a, b) => importPathSortKey(a[0]).localeCompare(importPathSortKey(b[0])));

  for (const [path, importsBySymbol] of sortedEntries) {
    if (path === excludePath) continue;
    const { _default, ...others } = importsBySymbol;

    const parts: Array<string> = [];
    if (_default) parts.push(withAlias(_default));

    const otherImportsDefs = Object.values(others);
    if (otherImportsDefs.length > 0) {
      parts.push(
        `{${
          otherImportsDefs
            .sort((a, b) => a.symbol.localeCompare(b.symbol))
            .map((importDef) => (" " + withAlias(importDef)))
            .join(",")
        } }`,
      );
    }

    codeLines.push(`import ${parts.join(", ")} from ${JSON.stringify(path)};`);
  }

  return codeLines.join("\n");
}
