import { describe, it, expect } from "vitest";
import { BeadRegistry } from "../../src/agent/bead-registry.js";
import { RegistryError } from "../../src/core/errors.js";
import type { BeadPluginFactory } from "../../src/agent/bead-plugin.js";

const mockFactory: BeadPluginFactory = () => ({ execute: async () => ({ rawOutput: "" }) });

describe("BeadRegistry", () => {
  it("resolves registered type to factory", () => {
    const registry = new BeadRegistry();
    registry.register("standard", mockFactory);
    const resolved = registry.resolve("standard");
    expect(resolved).toBe(mockFactory);
  });

  it("throws RegistryError for unknown type", () => {
    const registry = new BeadRegistry();
    expect(() => registry.resolve("nonexistent")).toThrow(RegistryError);
    expect(() => registry.resolve("nonexistent")).toThrow("Unknown bead type");
    expect(() => registry.resolve("nonexistent")).toThrow("nonexistent");
  });

  it("includes registered types in error message", () => {
    const registry = new BeadRegistry();
    registry.register("standard", mockFactory);
    registry.register("git-clone", mockFactory);
    expect(() => registry.resolve("unknown")).toThrow(/standard/);
    expect(() => registry.resolve("unknown")).toThrow(/git-clone/);
  });

  it("hasType returns true for registered, false for unregistered", () => {
    const registry = new BeadRegistry();
    registry.register("standard", mockFactory);
    expect(registry.hasType("standard")).toBe(true);
    expect(registry.hasType("other")).toBe(false);
  });

  it("registeredTypes returns all registered type names", () => {
    const registry = new BeadRegistry();
    registry.register("standard", mockFactory);
    registry.register("git-clone", mockFactory);
    const types = registry.registeredTypes();
    expect(types).toContain("standard");
    expect(types).toContain("git-clone");
    expect(types).toHaveLength(2);
  });

  it("overwrites existing registration", () => {
    const registry = new BeadRegistry();
    const factoryA: BeadPluginFactory = () => ({ execute: async () => ({ rawOutput: "A" }) });
    const factoryB: BeadPluginFactory = () => ({ execute: async () => ({ rawOutput: "B" }) });
    registry.register("standard", factoryA);
    registry.register("standard", factoryB);
    expect(registry.resolve("standard")).toBe(factoryB);
  });
});
