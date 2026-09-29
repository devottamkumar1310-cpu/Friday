/**
 * FRIDAY Mobile — Auth Context
 *
 * Stores the session token in SecureStore (native keychain/keystore) and
 * exposes sign-in / sign-out / sign-up through a React context.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { apiFetch } from '../lib/api';

const TOKEN_KEY = 'friday_session_token';
const USER_KEY = 'friday_user';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: AuthUser; token: string };

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, dateOfBirth: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  // On mount, restore persisted token.
  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        const userJson = await SecureStore.getItemAsync(USER_KEY);
        if (token && userJson) {
          const user = JSON.parse(userJson) as AuthUser;
          setState({ status: 'authenticated', user, token });
        } else {
          setState({ status: 'unauthenticated' });
        }
      } catch {
        setState({ status: 'unauthenticated' });
      }
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ data: { token: string; user: AuthUser } }>(
      '/api/v1/auth/sign-in',
      { method: 'POST', body: { email, password } },
    );
    const { token, user } = res.data;
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    setState({ status: 'authenticated', user, token });
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string, dateOfBirth: string) => {
      const res = await apiFetch<{ data: { token: string; user: AuthUser } }>(
        '/api/v1/auth/sign-up',
        { method: 'POST', body: { email, password, name, dateOfBirth } },
      );
      const { token, user } = res.data;
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
      setState({ status: 'authenticated', user, token });
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      const token = state.status === 'authenticated' ? state.token : null;
      if (token) {
        await apiFetch('/api/v1/auth/sign-out', {
          method: 'POST',
          token,
        }).catch(() => {
          // Best-effort; always clear locally.
        });
      }
    } finally {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(USER_KEY);
      setState({ status: 'unauthenticated' });
    }
  }, [state]);

  return (
    <AuthContext.Provider value={{ state, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRequireAuth(): { user: AuthUser; token: string } {
  const { state } = useAuth();
  if (state.status !== 'authenticated') {
    throw new Error('User is not authenticated');
  }
  return { user: state.user, token: state.token };
}
