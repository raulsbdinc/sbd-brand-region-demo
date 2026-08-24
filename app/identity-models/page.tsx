import type { Metadata } from "next"
import { IdentityUseCaseLab } from "@/components/identity-use-case-lab"

export const metadata: Metadata = {
  title: "Identity model decision",
  description:
    "Compare the four CIAM account and password models under stakeholder review.",
}

export default function IdentityModelsPage() {
  return <IdentityUseCaseLab />
}
