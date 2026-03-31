/**
 * TypeScript migration note:
 * - Shared domain contracts live here and remain the source of truth across routes, stores, services, and components.
 * - Runtime boundary guards continue to normalize external payloads before broader app use.
 * - Transitional JS compatibility shims were removed once the client module graph migrated to TypeScript.
 */
export * from './api';
export * from './auth';
export * from './call';
export * from './events';
export * from './matrix';
export * from './matrixSdk';
export * from './media';
export * from './routes';
