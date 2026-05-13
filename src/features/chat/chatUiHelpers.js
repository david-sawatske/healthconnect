export function bubbleStyleForRole(styles, { isMine, role, type }) {
  if (type === "SYSTEM") return [styles.bubble, styles.system];
  if (isMine) return [styles.bubble, styles.mine];

  switch (role) {
    case "PATIENT":
      return [styles.bubble, styles.patient];
    case "PROVIDER":
      return [styles.bubble, styles.provider];
    case "ADVOCATE":
      return [styles.bubble, styles.advocate];
    default:
      return [styles.bubble, styles.theirs];
  }
}

export function badgeStyleForRole(styles, { role, type }) {
  if (type === "SYSTEM") return [styles.badge, styles.badgeSystem];

  switch (role) {
    case "PATIENT":
      return [styles.badge, styles.badgePatient];
    case "PROVIDER":
      return [styles.badge, styles.badgeProvider];
    case "ADVOCATE":
      return [styles.badge, styles.badgeAdvocate];
    default:
      return [styles.badge, styles.badgeOther];
  }
}

export function getConversationTitle({ conversation, currentUserId, userMap }) {
  if (conversation.title) return conversation.title;

  const otherMembers = conversation.memberIds.filter(
    (id) => id !== currentUserId,
  );

  if (!conversation.isGroup && otherMembers.length === 1) {
    const otherUser = userMap[otherMembers[0]];
    return otherUser?.name || "Unknown User";
  }

  if (otherMembers.length > 0) {
    return otherMembers.map((id) => userMap[id]?.name || "Unknown").join(", ");
  }

  return "Conversation";
}
