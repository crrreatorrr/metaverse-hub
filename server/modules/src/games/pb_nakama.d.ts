// Typings PB needs beyond the hub's (Contract C3: interface merging only).
declare namespace nkruntime {
  interface Context {
    /** Set in match handler callbacks. */
    matchId?: string;
  }
}
