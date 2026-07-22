import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function productionLicenseInventory(lockfile) {
  return Object.entries(lockfile.packages)
    .filter(([path, entry]) => path && !entry.dev)
    .map(([path, entry]) => ({
      license: entry.license ?? "UNKNOWN",
      name: path.slice("node_modules/".length),
      version: entry.version
    }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

export async function generateLicenseInventory() {
  const lockfile = JSON.parse(await readFile(resolve(skillDir, "package-lock.json"), "utf8"));
  const inventory = {
    formatVersion: 1,
    packages: productionLicenseInventory(lockfile)
  };
  await writeFile(resolve(skillDir, "THIRD_PARTY_LICENSES.json"), `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

export async function checkLicenses() {
  const [lockfileText, inventoryText] = await Promise.all([
    readFile(resolve(skillDir, "package-lock.json"), "utf8"),
    readFile(resolve(skillDir, "THIRD_PARTY_LICENSES.json"), "utf8")
  ]);
  const expected = {
    formatVersion: 1,
    packages: productionLicenseInventory(JSON.parse(lockfileText))
  };
  const actual = JSON.parse(inventoryText);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("THIRD_PARTY_LICENSES.json does not match production dependencies in package-lock.json");
  }
  if (actual.packages.some((entry) => entry.license === "UNKNOWN")) {
    throw new Error("THIRD_PARTY_LICENSES.json contains production dependencies with unknown licenses");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) {
    await generateLicenseInventory();
    console.log("Generated production dependency license inventory");
  } else {
    await checkLicenses();
    console.log("Production dependency license inventory is current");
  }
}
