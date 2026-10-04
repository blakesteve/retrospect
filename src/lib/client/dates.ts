/* A night's date as plain arithmetic: days on, weekdays, months and the
   words for a date. Its own small module, so a view that only needs dates
   (the Sky view's dial) doesn't carry Every night's calendar (13). */

/** A night's date, "YYYY-MM-DD". */
export type NightDate = string;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAY = 86_400_000;
const at = (date: NightDate) => Date.parse(`${date}T12:00:00Z`);
export const addDays = (date: NightDate, n: number) => new Date(at(date) + n * DAY).toISOString().slice(0, 10);
export const weekdayOf = (date: NightDate) => new Date(at(date)).getUTCDay();
export const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
/** A month ("YYYY-MM") moved on, or back, by a number of months. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** "May 10, 2024" */
export const dateText = (date: NightDate) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
