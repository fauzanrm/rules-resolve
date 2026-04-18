const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  roots: ["<rootDir>/src", "<rootDir>/../../tests/web"],
  modulePaths: ["<rootDir>/node_modules"],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
};

module.exports = createJestConfig(config);
