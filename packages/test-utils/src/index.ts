// IMPORTANT: This barrel must NEVER (directly or transitively) import
// `@grackle-ai/database`. Test files mock that package with a factory that
// dynamically imports this barrel (`createDatabaseMock`); if the barrel pulls
// in `@grackle-ai/database`, vitest re-enters the in-flight mock factory and
// deadlocks the worker forever (CI hangs). Database-touching helpers live
// behind the separate `@grackle-ai/test-utils/db` entry point instead.
export {
  createDatabaseMock,
  createTaskServiceMock,
  type TaskServiceMock,
} from "./mock-database.js";
