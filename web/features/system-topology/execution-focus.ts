/** Exact physical IDs linked to the active stages in the selected native moment. */
export interface SystemExecutionFocus {
 componentIds:readonly string[];
 boundaryIds:readonly string[];
}

/** Navigation context is separate from the exact current execution highlights. */
export interface SystemCameraFollow {
 enabled:boolean;
 runKey:string;
 focus?:SystemExecutionFocus;
 held?:boolean;
}
