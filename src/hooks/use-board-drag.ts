"use client";

import {
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardCode,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  defaultKeyboardCoordinateGetter,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Status } from "@prisma/client";
import { useEffect, useRef, useState } from "react";

import { getBoards } from "@/lib/board-preferences";

export const ARCHIVED_DROP_ID = "archived";
export const SIDEBAR_EDGE_DROP_ID = "sidebar-edge";
const SIDEBAR_EDGE_DWELL_MS = 450;
type DragSource = "board" | "sidebar" | "archived";

const kanbanKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const activeData = args.context.active?.data.current;
  if (activeData?.source !== "board") return defaultKeyboardCoordinateGetter(event, args);
  if (![KeyboardCode.Left, KeyboardCode.Right, KeyboardCode.Up, KeyboardCode.Down].includes(event.code as KeyboardCode)) return undefined;

  if (event.code === KeyboardCode.Up || event.code === KeyboardCode.Down) return args.currentCoordinates;

  const overId = args.context.over?.id as Status | undefined;
  const originStatus = activeData.status as Status | undefined;
  const statuses: Status[] = getBoards().map((board) => board.status);
  const currentStatus = overId && statuses.includes(overId) ? overId : originStatus;
  const currentIndex = currentStatus ? statuses.indexOf(currentStatus) : -1;
  if (currentIndex < 0) return args.currentCoordinates;

  const offset = event.code === KeyboardCode.Right ? 1 : -1;
  const targetStatus = statuses[currentIndex + offset];
  if (!targetStatus) return args.currentCoordinates;

  const targetRect = args.context.droppableRects.get(targetStatus);
  const activeRect = args.context.collisionRect;
  if (!targetRect || !activeRect) return args.currentCoordinates;

  return {
    x: targetRect.left + (targetRect.width - activeRect.width) / 2,
    y: args.currentCoordinates.y,
  };
};

const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (args.active.data.current?.source === "sidebar") {
    return pointerCollisions.filter(({ id }) => id === ARCHIVED_DROP_ID);
  }
  const edgeCollision = pointerCollisions.find(({ id }) => id === SIDEBAR_EDGE_DROP_ID);
  return edgeCollision ? [edgeCollision] : closestCorners(args);
};

export function useBoardDrag({ sidebarCollapsed, setSidebarCollapsed, onDrop }: {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  onDrop: (event: DragEndEvent) => Promise<void>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragSource, setActiveDragSource] = useState<DragSource | null>(null);
  const [isPointerNearRail, setIsPointerNearRail] = useState(false);
  const sidebarEdgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartedCollapsed = useRef(false);
  const autoExpandedSidebar = useRef(false);
  const pointerNearRail = useRef(false);
  const dragStartBoardScrollLeft = useRef<number | null>(null);
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: kanbanKeyboardCoordinates,
      keyboardCodes: { start: [KeyboardCode.Space], end: [KeyboardCode.Space], cancel: [KeyboardCode.Esc] },
      scrollBehavior: "auto",
    }),
  );

  useEffect(() => () => {
    document.body.classList.remove("nook-dragging");
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerPosition.current = { x: event.clientX, y: event.clientY };
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (touch) lastPointerPosition.current = { x: touch.clientX, y: touch.clientY };
    };
    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: true });
    window.addEventListener("touchmove", handleTouchMove, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("touchmove", handleTouchMove, true);
    };
  }, []);

  function clearSidebarEdgeTimer() {
    if (sidebarEdgeTimer.current) {
      clearTimeout(sidebarEdgeTimer.current);
      sidebarEdgeTimer.current = null;
    }
  }

  function setPointerNearRail(nextNearRail: boolean) {
    if (pointerNearRail.current === nextNearRail) return;
    pointerNearRail.current = nextNearRail;
    setIsPointerNearRail(nextNearRail);
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    setActiveId(String(data?.applicationId ?? event.active.id));
    setActiveDragSource((data?.source as DragSource | undefined) ?? "board");
    document.body.classList.add("nook-dragging");
    dragStartedCollapsed.current = sidebarCollapsed;
    autoExpandedSidebar.current = false;
    setPointerNearRail(false);
    dragStartBoardScrollLeft.current = sidebarCollapsed
      ? document.querySelector<HTMLElement>(".board-scroll")?.scrollLeft ?? null
      : null;
    const activatorEvent = event.activatorEvent as PointerEvent | TouchEvent;
    if ("clientX" in activatorEvent && typeof activatorEvent.clientX === "number" && typeof activatorEvent.clientY === "number") {
      lastPointerPosition.current = { x: activatorEvent.clientX, y: activatorEvent.clientY };
    } else if ("touches" in activatorEvent) {
      const touch = activatorEvent.touches[0] ?? activatorEvent.changedTouches[0];
      if (touch) lastPointerPosition.current = { x: touch.clientX, y: touch.clientY };
    } else {
      lastPointerPosition.current = null;
    }
  }

  function handleDragMove() {
    if (!dragStartedCollapsed.current) {
      setPointerNearRail(false);
      return;
    }
    const pointerPosition = lastPointerPosition.current;
    if (!pointerPosition) {
      setPointerNearRail(false);
      return;
    }
    if (autoExpandedSidebar.current) {
      const boardRect = document.querySelector<HTMLElement>(".board-scroll")?.getBoundingClientRect();
      setPointerNearRail(Boolean(boardRect && pointerPosition.x >= boardRect.right - 16 && pointerPosition.y >= boardRect.top && pointerPosition.y <= boardRect.bottom));
      return;
    }
    const rail = document.querySelector<HTMLElement>(".sidebar-edge-rail");
    if (!rail) {
      setPointerNearRail(false);
      return;
    }
    const railRect = rail.getBoundingClientRect();
    const nearRail = pointerPosition.x >= railRect.left - 16 && pointerPosition.x <= railRect.right + 16 && pointerPosition.y >= railRect.top && pointerPosition.y <= railRect.bottom;
    setPointerNearRail(nearRail);
    if (nearRail && dragStartBoardScrollLeft.current !== null) {
      const boardScroll = document.querySelector<HTMLElement>(".board-scroll");
      if (boardScroll) boardScroll.scrollLeft = dragStartBoardScrollLeft.current;
    }
    if (!nearRail) {
      clearSidebarEdgeTimer();
      return;
    }
    if (sidebarEdgeTimer.current) return;
    sidebarEdgeTimer.current = setTimeout(() => {
      sidebarEdgeTimer.current = null;
      autoExpandedSidebar.current = true;
      setSidebarCollapsed(false);
    }, SIDEBAR_EDGE_DWELL_MS);
  }

  function finishDrag() {
    clearSidebarEdgeTimer();
    setActiveId(null);
    setActiveDragSource(null);
    document.body.classList.remove("nook-dragging");
    lastPointerPosition.current = null;
    dragStartBoardScrollLeft.current = null;
    setPointerNearRail(false);
    if (autoExpandedSidebar.current) {
      autoExpandedSidebar.current = false;
      setSidebarCollapsed(true);
    }
    dragStartedCollapsed.current = false;
  }

  async function handleDragEnd(event: DragEndEvent) {
    finishDrag();
    await onDrop(event);
  }

  return {
    activeId,
    activeDragSource,
    sensors,
    collisionDetection: collisionDetectionStrategy,
    autoScroll: !isPointerNearRail,
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onDragCancel: finishDrag,
  };
}
