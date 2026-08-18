/** Host Discord OAuth is admin-only. Public `.public` states are rejected. */
export function isHostOperatorOAuthState(state: string): boolean {
  return state.endsWith(".admin");
}

export function discordOauthReturnPath(_state: string): "/admin/discord" {
  return "/admin/discord";
}
