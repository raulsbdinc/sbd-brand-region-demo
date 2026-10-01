// Static cross-brand / cross-region notice shown in the sign-in drawer. Pure so
// the exact customer copy is unit-tested per market.
//
// FR/DE (Oct 1 direction): DeWalt France and DeWalt Germany share ONE DeWalt
// credential (sbd-emea-dewalt); Stanley France has its own independent password
// (sbd-emea-stanley); the UK is a separate region with separate accounts. The
// old "one Stanley Black & Decker account works across brands" line is wrong
// there and must not be shown.

export function brandRegionNotice(market?: string): string {
  if (market === "fr" || market === "de") {
    return "Your DeWalt email and password work on DeWalt France and DeWalt Germany. Stanley needs its own sign-up and password. UK sites are a separate region with their own accounts."
  }
  return "One Stanley Black & Decker account works across DeWalt, Stanley and our other brands. You\u2019ll sign in separately on each site."
}

/** Sign-up "address may already be registered" copy. On FR/DE brand passwords
 *  are independent, so never claim one account works across every brand. */
export function accountExistsNotice(market?: string): string {
  if (market === "fr" || market === "de") {
    return "You may already have an account for this site with this address. Try signing in instead, or use \u201cForgot password\u201d if you don\u2019t remember it."
  }
  return "You may already have a Stanley Black & Decker account with this address. One account works across DeWalt, Stanley and our other brands, so try signing in instead."
}
