/**
 * Coach screen — chat interface for the FRIDAY AI Coach.
 * Streams responses from POST /api/v1/coach/threads/{threadId}/messages.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { apiFetch, BASE_URL } from '../../src/lib/api';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

type Thread = {
  id: string;
};

export default function CoachScreen() {
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;

  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const initThread = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch<{ data: Thread[] }>('/api/v1/coach/threads', { token });
      const existing = res.data[0] ?? null;
      if (existing) {
        setThread(existing);
        const msgRes = await apiFetch<{ data: Message[] }>(
          `/api/v1/coach/threads/${existing.id}/messages`,
          { token },
        );
        setMessages(msgRes.data ?? []);
      } else {
        // Create a new thread
        const newRes = await apiFetch<{ data: Thread }>('/api/v1/coach/threads', {
          method: 'POST',
          token,
          body: {},
        });
        setThread(newRes.data);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load Coach.';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    initThread();
  }, [initThread]);

  async function handleSend() {
    if (!input.trim() || !thread || !token || sending) return;
    const userMessage = input.trim();
    setInput('');
    setSending(true);

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Placeholder for streaming assistant reply
    const tempAssistantMsg: Message = {
      id: `temp-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempAssistantMsg]);

    try {
      // The web app uses SSE streaming. For mobile, we use a fetch with reader.
      const response = await fetch(
        `${BASE_URL}/api/v1/coach/threads/${thread.id}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Session-Token': token,
          },
          body: JSON.stringify({ content: userMessage }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('text/event-stream') && response.body) {
        // Stream SSE response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') break;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.content ?? '';
                accumulated += delta;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: accumulated,
                  };
                  return updated;
                });
              } catch {
                // non-JSON SSE line
              }
            }
          }
        }
      } else {
        // Non-streaming JSON response
        const json = await response.json();
        const content =
          json?.data?.content ?? json?.content ?? 'I received your message.';
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content,
          };
          return updated;
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send message.';
      // Remove the temp assistant placeholder
      setMessages((prev) => prev.slice(0, -1));
      Alert.alert('Error', message);
    } finally {
      setSending(false);
    }
  }

  function renderMessage({ item }: { item: Message }) {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {!isUser && <Text style={styles.roleLabel}>FRIDAY Coach</Text>}
        {item.content ? (
          <Text style={[styles.messageText, isUser ? styles.userText : styles.assistantText]}>
            {item.content}
          </Text>
        ) : (
          <ActivityIndicator size="small" color="#1d4ed8" />
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1d4ed8" />
        <Text style={styles.loadingText}>Loading Coach…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>Ask your Coach anything</Text>
          <Text style={styles.emptyBody}>
            "What should I study this week?"{'\n'}
            "Why am I struggling with Integration?"
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
        />
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={setInput}
          placeholder="Ask your Coach…"
          placeholderTextColor="#9ca3af"
          multiline
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
          activeOpacity={0.8}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendButtonText}>↑</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#f9fafb',
  },
  loadingText: { marginTop: 12, color: '#6b7280', fontSize: 15 },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptyBody: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
    fontStyle: 'italic',
  },
  messageList: { padding: 16, paddingBottom: 8 },
  messageBubble: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    maxWidth: '85%',
  },
  userBubble: { backgroundColor: '#1d4ed8', alignSelf: 'flex-end' },
  assistantBubble: {
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  roleLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1d4ed8',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  messageText: { fontSize: 15, lineHeight: 22 },
  userText: { color: '#fff' },
  assistantText: { color: '#111827' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#1d4ed8',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 24 },
});
