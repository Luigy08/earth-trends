declare module 'jstat' {
  export const jStat: {
    studentt: {
      cdf(value: number, degreesOfFreedom: number): number;
      inv(probability: number, degreesOfFreedom: number): number;
    };
  };
}
