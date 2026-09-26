import { EventType, Status } from "@prisma/client";

export type ParsedStatusTransition = {
  fromStatus: Status | null;
  toStatus: Status;
};

export type StatusHistoryEvent = {
  id: string;
  type: EventType;
  fromStatus: Status | null;
  toStatus: Status | null;
  detail: string | null;
  createdAt: Date | string;
};

const statusNames = Object.values(Status);
const transitionDetailPattern = new RegExp(
  `^(null|${statusNames.join("|")}) → (${statusNames.join("|")})$`,
);

export function statusTransitionDetail(fromStatus: Status | null, toStatus: Status) {
  return `${fromStatus ?? "null"} → ${toStatus}`;
}

export function parseStatusTransitionDetail(detail: string | null): ParsedStatusTransition | null {
  if (detail === null) return null;
  const match = transitionDetailPattern.exec(detail);
  if (!match) return null;
  const fromStatus = match[1] === "null" ? null : match[1] as Status;
  const toStatus = match[2] as Status;
  if (fromStatus === toStatus) return null;
  return { fromStatus, toStatus };
}

export function isValidStatusTransition(
  fromStatus: Status | null,
  toStatus: Status | null,
): toStatus is Status {
  return toStatus !== null && fromStatus !== toStatus;
}

export function analyzeStatusHistory(currentStatus: Status, events: StatusHistoryEvent[]) {
  const statusEvents = events
    .filter((event) => event.type === EventType.STATUS_CHANGE)
    .sort((left, right) => {
      const timeOrder = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return timeOrder || left.id.localeCompare(right.id);
    });

  const knownStatuses = new Set<Status>([currentStatus]);
  const transitions: ParsedStatusTransition[] = [];
  let everyEventTypedAndValid = statusEvents.length > 0;

  for (const event of statusEvents) {
    if (!isValidStatusTransition(event.fromStatus, event.toStatus)) {
      everyEventTypedAndValid = false;
      continue;
    }
    transitions.push({ fromStatus: event.fromStatus, toStatus: event.toStatus });
    if (event.fromStatus !== null) knownStatuses.add(event.fromStatus);
    knownStatuses.add(event.toStatus);
  }

  let complete = everyEventTypedAndValid && transitions.length === statusEvents.length;
  if (complete) {
    complete = statusEvents.every((event, index) =>
      index === 0 || new Date(event.createdAt).getTime() !== new Date(statusEvents[index - 1].createdAt).getTime(),
    );
  }
  if (complete) {
    complete = transitions[0].fromStatus === null;
    for (let index = 1; complete && index < transitions.length; index += 1) {
      complete = transitions[index].fromStatus === transitions[index - 1].toStatus;
    }
    complete = complete && transitions.at(-1)?.toStatus === currentStatus;
  }

  const latestTime = statusEvents.length ? new Date(statusEvents.at(-1)!.createdAt).getTime() : null;
  const latestGroup = latestTime === null ? [] : statusEvents.filter((event) => new Date(event.createdAt).getTime() === latestTime);
  const latestTransition = latestGroup.length && latestGroup.every((event) => isValidStatusTransition(event.fromStatus, event.toStatus))
    ? latestGroup.find((event) => event.toStatus === currentStatus) ?? null
    : null;

  return { complete, knownStatuses, latestStatusEvent: latestTransition };
}
