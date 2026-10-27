/** A source read may acknowledge only the invalidations it started after. */
export const makeSourceFence = () => {
  let generation = 0;
  let accepted = -1;
  return {
    capture: () => generation,
    invalidate: () => {
      generation += 1;
    },
    dirty: () => generation !== accepted,
    accept: (started: number) => {
      if (started !== generation) return false;
      accepted = started;
      return true;
    },
  };
};
