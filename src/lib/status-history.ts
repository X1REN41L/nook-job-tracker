import { EventType, type Status } from "@prisma/client";

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

export function statusTransitionDetail(fromStatus: Status | null, toStatus: Status) {
  return `${fromStatus ?? "null"} → ${toStatus}`;
}

export type StatusEventDeletion = {
  deleteIds: string[];
  update: { id: string; fromStatus: Status; detail: string } | null;
  status: Status;
};

/**
 * Plans removing one status change while keeping the rest of the history a connected sequence:
 * the following change is reattached to the step before the removed one, and if that makes it a
 * no-op (back to the same status) it goes too. Removing the latest change moves the application
 * back to the status it came from. Returns null when the event is not a status change.
 */
export function planStatusEventDeletion(currentStatus: Status, events: StatusHistoryEvent[], eventId: string): StatusEventDeletion | null {
  const statusEvents = events
    .filter((event) => event.type === EventType.STATUS_CHANGE)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || left.id.localeCompare(right.id));
  const index = statusEvents.findIndex((event) => event.id === eventId);
  if (index < 0) return null;
  const target = statusEvents[index];
  const next = statusEvents[index + 1];

  if (!next) {
    const revert = target.fromStatus !== null && target.toStatus === currentStatus;
    return { deleteIds: [target.id], update: null, status: revert ? target.fromStatus! : currentStatus };
  }
  if (target.fromStatus === null || target.toStatus === null || next.fromStatus !== target.toStatus || next.toStatus === null) {
    return { deleteIds: [target.id], update: null, status: currentStatus };
  }
  if (next.toStatus === target.fromStatus) return { deleteIds: [target.id, next.id], update: null, status: currentStatus };
  return {
    deleteIds: [target.id],
    update: { id: next.id, fromStatus: target.fromStatus, detail: statusTransitionDetail(target.fromStatus, next.toStatus) },
    status: currentStatus,
  };
}

// A new event must sort after the existing history even if the clock is behind its latest event.
export function nextStatusEventTime(latestEventAt: Date | null, now = new Date()) {
  return latestEventAt && latestEventAt.getTime() >= now.getTime() ? new Date(latestEventAt.getTime() + 1) : now;
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
