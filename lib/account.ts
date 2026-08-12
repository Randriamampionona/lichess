import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "./firebase";

export type Profile = {
  uid: string;
  email: string;
  nickname: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
};

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function watchAuth(cb: (u: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGoogle(): Promise<User> {
  const res = await signInWithPopup(auth, provider);
  return res.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}

/** Create the profile on first sign-in; store the Google email + default nickname. */
export async function ensureProfile(
  uid: string,
  defaultNick: string,
  email: string,
): Promise<Profile> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as Omit<Profile, "uid">;
    // backfill email for accounts created before this field existed
    if (!data.email && email) {
      await setDoc(
        ref,
        { email, updatedAt: serverTimestamp() },
        { merge: true },
      );
      data.email = email;
    }
    return { uid, ...data };
  }
  const nickname = (defaultNick || "Player").slice(0, 18);
  const fresh = {
    email: email || "",
    nickname,
    rating: 400,
    wins: 0,
    losses: 0,
    draws: 0,
    games: 0,
  };
  await setDoc(ref, {
    ...fresh,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { uid, ...fresh };
}

export function watchProfile(uid: string, cb: (p: Profile | null) => void) {
  return onSnapshot(doc(db, "users", uid), (s) =>
    cb(s.exists() ? { uid, ...(s.data() as Omit<Profile, "uid">) } : null),
  );
}

/** Client may ONLY change nickname (rules lock rating/stats). */
export async function setNickname(uid: string, nickname: string) {
  await setDoc(
    doc(db, "users", uid),
    { nickname: nickname.slice(0, 18), updatedAt: serverTimestamp() },
    { merge: true },
  );
}
