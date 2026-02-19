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
