/** Office display only: shared accounts retain their login, membership and assignments. */
export function officeRosterFilter(organizationId:string) {
  return {
    organizationId,
    name:{$not:/^\s*the\s+media\s+shop\s+support\s*$/i},
  };
}
