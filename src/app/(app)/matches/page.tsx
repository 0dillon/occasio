import { redirect } from "next/navigation";

// D12: the board is free, so there's nothing to unlock. Old links land on the board.
export default function Matches() {
  redirect("/discover");
}
