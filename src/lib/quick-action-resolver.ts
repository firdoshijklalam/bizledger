/**
 * §STEP-4E-REVIEW: Pure helper — resolve the party type from a quick action type.
 *
 * Extracted from khata-view.tsx to make the routing logic testable
 * without React component mounting. Also avoids the eslint
 * react-hooks/set-state-in-effect rule by moving the branching
 * out of the useEffect body.
 *
 * @param actionType - The QuickAction.type value
 * @returns 'customer' | 'supplier' | null (null = default/customer)
 */
export function resolvePartyTypeFromAction(
  actionType: string,
): 'customer' | 'supplier' | null {
  if (actionType === 'add-customer') return 'customer'
  if (actionType === 'add-supplier') return 'supplier'
  // add-party and all other party-creation actions default to null
  // (PartyForm defaults to 'customer' when initialType is null/undefined)
  return null
}

/**
 * §STEP-4E-REVIEW: Check if a quick action type should open the PartyForm.
 */
export function shouldOpenPartyForm(actionType: string): boolean {
  return actionType === 'add-party'
    || actionType === 'add-customer'
    || actionType === 'add-supplier'
}
