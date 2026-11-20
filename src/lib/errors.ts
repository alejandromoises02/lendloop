import { ConvexError } from "convex/values";

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Please sign in again.",
  FORBIDDEN: "You are not allowed to do that.",
  NOT_FOUND: "That item no longer exists.",
  CANNOT_BORROW_OWN_TOOL: "You can't borrow your own tool.",
  DUPLICATE_REQUEST: "You already have a request for these dates.",
  DATES_ALREADY_BOOKED: "Those dates overlap with an approved loan.",
  INVALID_TRANSITION: "This request was already handled.",
  INVALID_DATE: "Please pick valid dates.",
  START_IN_PAST: "The start date can't be in the past.",
  END_BEFORE_START: "The end date must be on or after the start date.",
  RANGE_TOO_LONG: "Loans can last up to 30 days.",
  TOOL_ON_LOAN: "This tool is currently on loan and can't be removed.",
  NAME_REQUIRED: "Name is required.",
  NAME_TOO_LONG: "Name is too long.",
  DESCRIPTION_REQUIRED: "Description is required.",
  DESCRIPTION_TOO_LONG: "Description is too long.",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") {
    return MESSAGES[err.data] ?? "Something went wrong.";
  }
  return "Something went wrong. Please try again.";
}
