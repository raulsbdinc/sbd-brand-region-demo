// Static cross-brand / cross-region notice shown in the sign-in drawer (sign-up,
// sign-in and recovery). Pure so the exact customer copy is unit-tested per
// market AND brand.
//
// Model 4 only: a credential is scoped to ONE brand within ONE region. DeWalt
// France and DeWalt Germany share the EU DeWalt credential; Stanley France has
// its own. In the UK, DeWalt UK and Stanley UK each have their own credential,
// and the UK is a separate region from FR/DE. No copy may claim that one
// account or password works across brands — that was the removed shared model.

type BrandName = "DeWalt" | "Stanley"

function brandNames(brand?: string): { here: BrandName; other: BrandName } {
  return brand === "stanley" ? { here: "Stanley", other: "DeWalt" } : { here: "DeWalt", other: "Stanley" }
}

export function brandRegionNotice(market?: string, brand?: string): string {
  const { here, other } = brandNames(brand)
  if (market === "fr" || market === "de") {
    if (here === "Stanley") {
      return "Your Stanley email and password work on Stanley France. DeWalt needs its own sign-up and password. UK sites are a separate region with their own accounts."
    }
    return "Your DeWalt email and password work on DeWalt France and DeWalt Germany. Stanley needs its own sign-up and password. UK sites are a separate region with their own accounts."
  }
  return `Your ${here} email and password work on ${here} UK. ${other} needs its own sign-up and password. France and Germany sites are a separate region with their own accounts.`
}

/** Sign-up "address may already be registered" copy. Brand passwords are
 *  independent everywhere, so never claim one account works across brands. */
export function accountExistsNotice(market?: string, brand?: string): string {
  if (market === "fr" || market === "de") {
    return "You may already have an account for this site with this address. Try signing in instead, or use \u201cForgot password\u201d if you don\u2019t remember it."
  }
  const { here } = brandNames(brand)
  return `You may already have a ${here} UK account with this address. Try signing in instead, or use \u201cForgot password\u201d if you don\u2019t remember it.`
}
