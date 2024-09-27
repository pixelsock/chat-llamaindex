"use client";

import { useBotStore } from "@/app/store/bot";
import { useChat } from "ai/react";
import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useClientConfig } from "@/cl/app/components/ui/chat/hooks/use-config";

// Combine useChat and useBotStore to manage chat session
export function useChatSession() {
  const botStore = useBotStore();
  const bot = botStore.currentBot();
  const session = botStore.currentSession();
  const { updateBotSession } = botStore;

  const [isFinished, setIsFinished] = useState(false);
  const { backend } = useClientConfig();

  const currentBotIdRef = useRef(bot.id);

  const chatBody = useMemo(
    () => ({
      context: bot.context,
      modelConfig: bot.modelConfig,
      datasource: bot.datasource,
    }),
    [bot.context, bot.modelConfig, bot.datasource],
  );

  const {
    messages,
    setMessages,
    input,
    isLoading,
    handleSubmit,
    handleInputChange,
    reload,
    stop,
    append,
    setInput,
  } = useChat({
    api: `${backend}/api/chat`,
    headers: {
      "Content-Type": "application/json", // using JSON because of vercel/ai 2.2.26
    },
    body: chatBody,
    onError: (error: unknown) => {
      if (!(error instanceof Error)) throw error;
      const message = JSON.parse(error.message);
      alert(message.detail);
    },
    onFinish: () => setIsFinished(true),
  });

  // load chat history from session when component mounts or bot changes
  useEffect(() => {
    if (currentBotIdRef.current !== bot.id) {
      setMessages(session.messages);
      currentBotIdRef.current = bot.id;
    }
  }, [bot.id, session.messages, setMessages]);

  // sync chat history with bot session when finishing streaming
  useEffect(() => {
    if (isFinished) {
      if (messages.length > 0) {
        updateBotSession((session) => {
          session.messages = messages;
        }, bot.id);
      }
      setIsFinished(false);
    }
  }, [isFinished, messages, updateBotSession, bot.id]);

  return {
    messages,
    input,
    isLoading,
    handleSubmit,
    handleInputChange,
    reload,
    stop,
    append,
    setInput,
  };
}
