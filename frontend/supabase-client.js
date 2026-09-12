const SUPABASE_URL = "https://useznlwpqhwlkvobmfxb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_dIidFYZAYORVyCslcIHmXg_Q36oIIyG";
const SUPABASE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let clientPromise;

async function getClient() {
  if (!clientPromise) {
    clientPromise = import(SUPABASE_MODULE_URL).then(({ createClient }) => createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    ));
  }
  return clientPromise;
}

function normalizeUsername(username) {
  return username.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

async function usernameToInternalEmail(username) {
  const bytes = new TextEncoder().encode(normalizeUsername(username));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hash}@users.pentazen.invalid`;
}

function validateCredentials(username, password) {
  const cleanUsername = username.normalize("NFKC").trim();
  if (cleanUsername.length < 2 || cleanUsername.length > 20) {
    throw new Error("用户名需要包含 2 到 20 个字符");
  }
  if (password.length < 6) {
    throw new Error("密码至少需要 6 个字符");
  }
  return cleanUsername;
}

function throwIfError(error) {
  if (!error) return;
  if (error.message?.includes("User already registered")) {
    throw new Error("这个用户名已经被注册");
  }
  if (error.message?.includes("Invalid login credentials")) {
    throw new Error("用户名或密码不正确");
  }
  if (error.message?.includes("Database error saving new user")) {
    throw new Error("这个用户名已经被注册，或用户名不符合要求");
  }
  throw new Error(error.message || "网络操作失败，请重试");
}

export async function signUpWithUsername(username, password) {
  const cleanUsername = validateCredentials(username, password);
  const client = await getClient();
  const email = await usernameToInternalEmail(cleanUsername);
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { username: cleanUsername } },
  });
  throwIfError(error);
  if (!data.session) {
    throw new Error("账号已创建，但邮箱确认仍处于开启状态，请检查 Supabase 设置");
  }
  return getCurrentAccount();
}

export async function signInWithUsername(username, password) {
  const cleanUsername = validateCredentials(username, password);
  const client = await getClient();
  const email = await usernameToInternalEmail(cleanUsername);
  const { error } = await client.auth.signInWithPassword({ email, password });
  throwIfError(error);
  return getCurrentAccount();
}

export async function signOutAccount() {
  const client = await getClient();
  const { error } = await client.auth.signOut();
  throwIfError(error);
}

export async function getCurrentAccount() {
  const client = await getClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  throwIfError(sessionError);
  const user = sessionData.session?.user;
  if (!user) return null;

  const { data: profile, error } = await client
    .from("profiles")
    .select("id, username")
    .eq("id", user.id)
    .single();
  throwIfError(error);
  return profile;
}

function unwrapRoom(data) {
  return Array.isArray(data) ? data[0] : data;
}

export async function createOnlineRoom() {
  const client = await getClient();
  const { data, error } = await client.rpc("create_room");
  throwIfError(error);
  return unwrapRoom(data);
}

export async function joinOnlineRoom(code) {
  const client = await getClient();
  const { data, error } = await client.rpc("join_room", {
    room_code: code.trim().toUpperCase(),
  });
  throwIfError(error);
  return unwrapRoom(data);
}

export async function playOnlineMove(code, x, y) {
  const client = await getClient();
  const { data, error } = await client.rpc("play_move", {
    room_code: code,
    move_x: x,
    move_y: y,
  });
  throwIfError(error);
  return unwrapRoom(data);
}

export async function surrenderOnlineRoom(code) {
  const client = await getClient();
  const { data, error } = await client.rpc("surrender_room", { room_code: code });
  throwIfError(error);
  return unwrapRoom(data);
}

export async function loadOnlineRoom(roomId) {
  const client = await getClient();
  const [{ data: room, error: roomError }, { data: moves, error: movesError }] = await Promise.all([
    client.from("rooms").select("*").eq("id", roomId).single(),
    client.from("moves").select("move_no, x, y, player, user_id").eq("room_id", roomId).order("move_no"),
  ]);
  throwIfError(roomError);
  throwIfError(movesError);

  const ids = [room.host_id, room.guest_id].filter(Boolean);
  const { data: profiles, error: profilesError } = await client
    .from("profiles")
    .select("id, username")
    .in("id", ids);
  throwIfError(profilesError);
  return { room, moves, profiles };
}

export async function subscribeToOnlineRoom(roomId, onChange) {
  const client = await getClient();
  let queued = false;
  const notify = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      onChange();
    });
  };
  const channel = client
    .channel(`room:${roomId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "rooms",
      filter: `id=eq.${roomId}`,
    }, notify)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "moves",
      filter: `room_id=eq.${roomId}`,
    }, notify)
    .subscribe();

  return () => client.removeChannel(channel);
}
