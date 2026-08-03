import type { Metadata } from "next"
import { TeamInvitation } from "@/components/team-invitation"

export const metadata: Metadata = { title: "Invite a Pro teammate" }

export default function InvitePage() {
  return <TeamInvitation />
}
