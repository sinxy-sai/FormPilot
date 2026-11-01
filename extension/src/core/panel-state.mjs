export const initialPanelState = Object.freeze({ resume: null, task: null, plan: [], results: [], status: 'idle' });

export function reducePanelState(state = initialPanelState, action = {}) {
  const current = { ...initialPanelState, ...state };
  switch (action.type) {
    case 'resume/load': return { ...current, resume: action.resume ?? null, status: current.status === 'idle' ? 'ready' : current.status };
    case 'task/load': return { ...current, task: action.task ?? null, plan: action.task?.plan ?? current.plan, results: action.task?.results ?? [], status: action.task?.status ?? 'review' };
    case 'plan/set': return { ...current, plan: Array.isArray(action.plan) ? action.plan : [], status: 'review' };
    case 'plan/approve': return { ...current, plan: current.plan.map(item => action.fieldId == null || item.fieldId === action.fieldId ? { ...item, status: 'approved' } : item), status: 'approved' };
    case 'execute/start': return { ...current, status: 'executing' };
    case 'execute/result': return { ...current, results: action.results ?? [], status: 'completed' };
    case 'undo/result': return { ...current, results: action.results ?? [], status: 'undone' };
    case 'invalidate': return { ...current, task: current.task ? { ...current.task, status: 'invalidated', invalidatedReason: action.reason } : current.task, plan: current.plan.map(item => item.status === 'approved' ? { ...item, status: 'proposed' } : item), status: 'invalidated' };
    case 'reset': return { ...initialPanelState };
    default: return current;
  }
}
