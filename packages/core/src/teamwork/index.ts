// Public Teamwork API surface.

export type {
  TeamworkSessionScope,
  TeamworkSessionType,
  TeamworkSessionRef,
  TeamworkSessionMetadata,
  ContextEntry,
  FileContextEntry,
  RawContextEntry,
  ContextTarget,
  ContextMutationAction,
  EventOrigin,
  ThreadAction,
  InboxPolicy,
} from "./internal/store/schema.js";

export {
  GLOBAL_PROJECT_KEY,
  TEAMWORK_SESSION_TYPES,
  THREAD_ACTIONS,
  EVENT_ORIGINS,
  INBOX_POLICIES,
  parseTeamworkSessionScope,
  parseTeamworkSessionType,
  parseThreadAction,
  parseEventOrigin,
  parseInboxPolicy,
  normalizeThreadKey,
  buildContextEntries,
  contextEntryKey,
  asContextEntries,
  asStringArray,
} from "./internal/store/schema.js";

export type {
  TeamworkEvent,
  TeamworkEventKind,
  CreateTeamworkEvent,
  MessageTeamworkEvent,
  ThreadTeamworkEvent,
  ContextTeamworkEvent,
  TeamworkMetadataEvent,
  SpawnedTeamworkEvent,
  KilledTeamworkEvent,
  DoneTeamworkEvent,
  ErrorTeamworkEvent,
  ProgressTeamworkEvent,
  UndeliverableTeamworkEvent,
  InterruptRequestedTeamworkEvent,
  TurnStartedTeamworkEvent,
  TurnFinishedTeamworkEvent,
  InterruptedTeamworkEvent,
  SupervisorWarningTeamworkEvent,
  SupervisorWarningReason,
  CoordinationTeamworkEvent,
  CoordinationAction,
  CoordinationEntity,
  CoordinationState,
  CoordinationBatchState,
  CoordinationAssignmentState,
  CoordinationAttemptState,
  CoordinationTeammateState,
  InterruptReason,
  InterruptMethod,
  InterruptOutcome,
  UndeliverableReason,
  ReadTeamworkEventsPagination,
  AppendablePartial,
} from "./internal/store/events.js";

export {
  TEAMWORK_EVENT_KINDS,
  DEFAULT_CURSOR_PAGE_SIZE,
  parseTeamworkEventKind,
  parseTeamworkEventKinds,
  isCreateEvent,
  isThreadEvent,
  isContextEvent,
  isTeamworkMetadataEvent,
  isCoordinationEvent,
  appendEvent,
  readLastSeq,
} from "./internal/store/events.js";

export type {
  WorkerState,
  WorkerLifecycle,
  WorkerActivity,
  WorkerRegistry,
} from "./internal/store/worker-state.js";

export {
  reduceWorkerRegistry,
  isTerminalLifecycle,
} from "./internal/store/worker-state.js";

export {
  DEFAULT_INBOX_POLICY,
  matchesInboxPolicy,
} from "./internal/store/inbox.js";

export type {
  DeliveryMode,
  UndeliverableTarget,
} from "./internal/store/delivery.js";

export {
  DELIVERY_MODES,
  parseDeliveryMode,
  classifyDelivery,
} from "./internal/store/delivery.js";

export type { TeamworkEventFilter } from "./internal/store/filter.js";
export type { WatchFilter } from "./internal/store/watch.js";

export {
  MEANINGFUL_EVENT_KINDS,
  matchesEventFilter,
} from "./internal/store/filter.js";

export {
  reduceTeamworkSessionMetadata,
} from "./internal/store/teamwork-session-metadata.js";

export {
  canTransition,
  assertCoordinationTransition,
  isCoordinationAction,
  reduceCoordinationState,
} from "./internal/store/coordination.js";
export type {
  CoordinationProjection,
  CoordinationBatchProjection,
  CoordinationAssignmentProjection,
  CoordinationAttemptProjection,
  CoordinationTeammateProjection,
  CoordinationLeaseProjection,
} from "./internal/store/coordination.js";

export type {
  ThreadState,
  ThreadAliasResolver,
} from "./internal/store/thread-state.js";

export {
  reduceThreads,
  buildThreadAliasResolver,
  collectThreadTimeline,
} from "./internal/store/thread-state.js";

export {
  createTeamworkSession,
} from "./api/create.js";

export {
  sendMessage,
} from "./api/send.js";

export {
  readWorkerInbox,
  watchWorkerInbox,
  WorkerInboxError,
} from "./api/inbox.js";
export type {
  ReadWorkerInboxInput,
  WatchWorkerInboxInput,
  WorkerInboxMessage,
  WorkerInboxErrorCode,
} from "./api/inbox.js";

export {
  postThread,
  renameThread,
} from "./api/post-thread.js";

export {
  addTeamworkSessionContext,
  deleteTeamworkSessionContext,
  listTeamworkSessionContext,
  addThreadContext,
  deleteThreadContext,
  listThreadContext,
} from "./api/context.js";

export {
  setTeamworkSessionTitle,
  clearTeamworkSessionTitle,
} from "./api/title.js";

export {
  readTeamworkEvents,
  readTeamworkSessionMetadata,
  listForumThreads,
  showThread,
} from "./api/read.js";
export type { ReadTeamworkEventsOptions } from "./api/read.js";

export {
  watchTeamworkEvents,
} from "./api/watch.js";
export type { WatchTeamworkSessionOptions } from "./api/watch.js";

export {
  watchTeamworkSessions,
  teamworkSessionCursorKey,
} from "./api/watch-sessions.js";
export type {
  WatchTeamworkSessionsInput,
  CrossTeamworkEvent,
  TeamworkSessionCursor,
  TeamworkSessionCursorKey,
} from "./api/watch-sessions.js";

export {
  listWorkers,
  watchWorkers,
  probeWorkerRuntime,
  reconcileWorkerLiveness,
} from "./api/workers.js";
export type {
  ListWorkersInput,
  WatchWorkersInput,
  WorkerRuntimeObservation,
  ProbeWorkerRuntimeInput,
  ReconcileWorkerLivenessInput,
  ReconcileWorkerLivenessResult,
} from "./api/workers.js";

export { spawnWorker } from "./api/spawn.js";
export {
  recordCoordinationEvent,
  readCoordinationState,
} from "./api/coordination.js";
export type {
  RecordCoordinationEventInput,
  ReadCoordinationStateInput,
} from "./api/coordination.js";
export {
  requestInterrupt,
  interruptWorker,
} from "./api/interrupt.js";
export type {
  InterruptWorkerInput,
  InterruptWorkerResult,
  InterruptDelivery,
} from "./api/interrupt.js";

export type {
  WorkerStartInput,
  WorkerRuntimeHandle,
  WorkerInterruptInput,
  WorkerInterruptResult,
  WorkerStopInput,
  WorkerStopResult,
  WorkerRuntime,
  SpawnWorkerInput,
} from "./api/runtime.js";

export { resolveTeamworkSession } from "./api/resolve.js";
export type { ResolveTeamworkSessionOptions } from "./api/resolve.js";

export type {
  TeamworkSessionAddressOptions,
  MutationCommonOptions,
  CreateTeamworkSessionOptions,
  SendMessageOptions,
  PostThreadOptions,
  ContextMutationOptions,
  ThreadContextMutationOptions,
  RenameThreadOptions,
  SetTeamworkSessionTitleOptions,
  ClearTeamworkSessionTitleOptions,
} from "./api/types.js";
