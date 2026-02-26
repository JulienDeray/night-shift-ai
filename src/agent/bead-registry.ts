import type { BeadPluginFactory } from "./bead-plugin.js";
import { RegistryError } from "../core/errors.js";

/**
 * Maps bead type strings from manifests to plugin factory functions.
 * Passed as a DI instance to the engine — NOT a singleton.
 */
export class BeadRegistry {
  private readonly factories = new Map<string, BeadPluginFactory>();

  /**
   * Register a plugin factory for a bead type.
   * Overwrites any existing registration for the same type.
   */
  register(type: string, factory: BeadPluginFactory): void {
    this.factories.set(type, factory);
  }

  /**
   * Resolve a bead type to its plugin factory.
   * Throws RegistryError if the type is not registered.
   */
  resolve(type: string): BeadPluginFactory {
    const factory = this.factories.get(type);
    if (!factory) {
      const registered = [...this.factories.keys()];
      const registeredList = registered.length > 0
        ? registered.join(', ')
        : '(none)';
      throw new RegistryError(
        `Unknown bead type "${type}". Registered types: ${registeredList}`
      );
    }
    return factory;
  }

  /** Check if a type is registered without throwing. */
  hasType(type: string): boolean {
    return this.factories.has(type);
  }

  /** Return all registered type names. Useful for diagnostics. */
  registeredTypes(): string[] {
    return [...this.factories.keys()];
  }
}
