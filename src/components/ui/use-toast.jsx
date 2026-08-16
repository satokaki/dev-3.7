import { useSyncExternalStore } from "react";

const TOAST_LIMIT = 5;
// Time before a dismissed toast is fully removed from state (for animation)
const TOAST_REMOVE_DELAY = 400;

const DURATION_BY_TYPE = {
  success: 3000,
  info: 3000,
  warning: 4000,
};

// DEV v3.7: destructive/error toast remains until manual close.
const PERSISTENT_TYPES = new Set(["error"]);

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
};

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

const toastTimeouts = new Map();
const dismissTimerKey = (toastId) => `dismiss-${toastId}`;
const removeTimerKey = (toastId) => `remove-${toastId}`;

const clearToastTimer = (key) => {
  const timer = toastTimeouts.get(key);
  if (!timer) return;
  clearTimeout(timer);
  toastTimeouts.delete(key);
};

const addToRemoveQueue = (toastId) => {
  const key = removeTimerKey(toastId);
  if (toastTimeouts.has(key)) return;

  const timeout = setTimeout(() => {
    toastTimeouts.delete(key);
    dispatch({ type: actionTypes.REMOVE_TOAST, toastId });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(key, timeout);
};

export const reducer = (state, action) => {
  switch (action.type) {
    case actionTypes.ADD_TOAST:
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case actionTypes.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case actionTypes.DISMISS_TOAST: {
      const { toastId } = action;
      if (toastId) addToRemoveQueue(toastId);
      else state.toasts.forEach((t) => addToRemoveQueue(t.id));

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          toastId === undefined || t.id === toastId ? { ...t, open: false } : t
        ),
      };
    }

    case actionTypes.REMOVE_TOAST:
      if (action.toastId === undefined) return { ...state, toasts: [] };
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };

    default:
      return state;
  }
};

const listeners = [];
let memoryState = { toasts: [] };

function dispatch(action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => listener(memoryState));
}

function subscribe(listener) {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) listeners.splice(index, 1);
  };
}

function getSnapshot() {
  return memoryState;
}

/**
 * DEV v3.7 behavior:
 * - success: 3s
 * - info: 3s
 * - warning: 4s
 * - error/destructive: persistent until manually closed
 *
 * Dedup: identical open toast (same title + description + type) is not added twice.
 */
export function toast({ type, variant, duration, title, description, ...rest } = {}) {
  const resolvedType = type || (variant === "destructive" ? "error" : "success");
  // DEV 3.7: semua toast dibuat persistent untuk kebutuhan debugging.
  // Toast hanya hilang jika user menutupnya secara manual.
  const persistent = true;
  const id = genId();

  const dur = persistent
    ? null
    : duration ?? DURATION_BY_TYPE[resolvedType] ?? 3000;

  const dup = memoryState.toasts.find(
    (t) =>
      t.open &&
      t.title === title &&
      t.description === description &&
      t.type === resolvedType
  );

  if (dup) {
    return {
      id: dup.id,
      dismiss: () => dismiss(dup.id),
      update: () => {},
    };
  }

  const dismissFn = () => {
    clearToastTimer(dismissTimerKey(id));
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId: id });
  };

  const update = (props) =>
    dispatch({
      type: actionTypes.UPDATE_TOAST,
      toast: { ...props, id },
    });

  dispatch({
    type: actionTypes.ADD_TOAST,
    toast: {
      ...rest,
      id,
      title,
      description,
      type: resolvedType,
      variant: resolvedType === "error" ? "destructive" : "default",
      duration: dur,
      persistent,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismissFn();
      },
    },
  });

  // DEV 3.7: seluruh toast persistent dan sengaja tidak memiliki auto-dismiss timer.
  if (!persistent) {
    const timer = setTimeout(() => {
      dismissFn();
    }, dur);
    toastTimeouts.set(dismissTimerKey(id), timer);
  }

  return { id, dismiss: dismissFn, update };
}

export function dismiss(toastId) {
  clearToastTimer(dismissTimerKey(toastId));
  dispatch({ type: actionTypes.DISMISS_TOAST, toastId });
}

export function useToast() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...state, toast, dismiss };
}