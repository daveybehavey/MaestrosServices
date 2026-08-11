/**
 * Load Growth Ops facts/evidence JSON from a facts directory.
 * Pure filesystem helpers; no Google API calls.
 */

import fs from "node:fs";
import path from "node:path";

const REQUIRED_FILES = [
  "business-facts.json",
  "services.json",
  "service-areas.json",
  "content-rules.json",
];

export const loadJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing Growth Ops file: ${filePath}`);
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Malformed JSON in ${filePath}: ${error instanceof Error ? error.message : error}`
    );
  }
};

export const loadProjectEvidence = (projectsDir) => {
  if (!fs.existsSync(projectsDir)) return [];
  const entries = fs
    .readdirSync(projectsDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return entries.map((name) => {
    const full = path.join(projectsDir, name);
    const data = loadJsonFile(full);
    return { ...data, _fileName: name };
  });
};

export const loadGrowthFacts = (factsDir) => {
  if (!factsDir || typeof factsDir !== "string") {
    throw new Error("factsDir is required");
  }
  const abs = path.resolve(factsDir);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing facts directory: ${abs}`);
  }

  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(abs, file))) {
      throw new Error(`Missing Growth Ops file: ${path.join(abs, file)}`);
    }
  }

  const business = loadJsonFile(path.join(abs, "business-facts.json"));
  const services = loadJsonFile(path.join(abs, "services.json"));
  const areas = loadJsonFile(path.join(abs, "service-areas.json"));
  const rules = loadJsonFile(path.join(abs, "content-rules.json"));
  const projects = loadProjectEvidence(path.join(abs, "projects"));

  return {
    root: abs,
    businessFacts: Array.isArray(business.facts) ? business.facts : [],
    services: Array.isArray(services.services) ? services.services : [],
    areas: Array.isArray(areas.areas) ? areas.areas : [],
    projects,
    rules,
  };
};

export const verifiedOnly = (items = []) =>
  items.filter((item) => item && item.status === "verified");

export const findByStatus = (items = [], status) =>
  items.filter((item) => item && item.status === status);
