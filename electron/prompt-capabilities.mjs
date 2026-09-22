/**
 * Grok Build omits `image: true` from initialize even though its prompt parser
 * accepts ImageContent. Scope the compatibility fix to the official grokShell
 * handshake; an arbitrary ACP executable must still advertise image support.
 * Source: xai-org/grok-build, src/agent/mvp_agent/acp_agent.rs and
 * src/session/prompt_parser.rs.
 */
export function promptCapabilities(hello) {
  const advertised = hello?.agentCapabilities?.promptCapabilities ?? {};
  return {
    image: advertised.image === true || hello?._meta?.grokShell === true,
    embeddedContext: advertised.embeddedContext === true,
  };
}
