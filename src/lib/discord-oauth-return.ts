/** After Discord OAuth, send admins back to the admin page and everyone else to /discord. */
export function discordOauthReturnPath(
  state: string,
): "/admin/discord" | "/discord" {
  return state.endsWith(".admin") ? "/admin/discord" : "/discord";
}
