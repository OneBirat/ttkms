import { notFound } from "next/navigation";
import { DatePickerDemo } from "./DatePickerDemo";

export const metadata = { title: "Date picker demo" };

/** Development-only playground for the shared date components. */
export default function DatePickerDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DatePickerDemo />;
}
