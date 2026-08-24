/**
 * Owns Trade renderer-to-main channels and their feature gate.
 *
 * Trade lifecycle cleanup remains beside subscription registration so a
 * destroyed renderer cannot retain a process-wide feed subscription.
 */
import type { AppSettings } from "../shared/contracts.js";
import { IPC } from "../shared/contracts.js";
import { AllowlistError, ValidationError } from "../shared/errors.js";
import {
  parseTraderPriceHistoryRequest,
  parseTradeSavedState,
  parseTradeSearchRequest,
  parseTradeSource,
  type TradeSavedState,
} from "../shared/trade-chat.js";
import type { TradeChatService } from "./core/trade-chat-service.js";
import {
  channel,
  sendIfLive,
  type AnyChannelDef,
  type Parser,
} from "./ipc-channel-registry.js";

export type TradeInvokeChannel =
  | "tradeSubscribe"
  | "tradeUnsubscribe"
  | "tradeSavedGet"
  | "tradeSavedSet"
  | "traderQuotesGet"
  | "traderPriceHistoryGet"
  | "tradeSearch"
  | "tradeRetry";

export interface TradeIpcContext {
  tradeChat: TradeChatService;
  getSettings: () => Promise<AppSettings>;
  getTradeSaved: () => Promise<TradeSavedState>;
  setTradeSaved: (value: TradeSavedState) => Promise<TradeSavedState>;
}

const nothing: Parser<void> = (args) => {
  if (args.length !== 0) throw new ValidationError("expected 0 IPC argument(s)");
};

const one = <In>(parse: (value: unknown) => In): Parser<In> => (args) => {
  if (args.length !== 1) throw new ValidationError("expected 1 IPC argument(s)");
  return parse(args[0]);
};

const validated = <Value>(
  parse: (value: unknown) => Value,
  message: string,
): Parser<Value> => one((value) => {
  try {
    return parse(value);
  } catch {
    throw new ValidationError(message);
  }
});

export function tradeChannelDefinitions(
  ctx: TradeIpcContext,
): Record<TradeInvokeChannel, AnyChannelDef> {
  const cleanupInstalled = new Set<number>();
  const requireEnabled = async (): Promise<void> => {
    if (!(await ctx.getSettings()).gwonmacTools) {
      throw new AllowlistError("trade chat is disabled");
    }
  };
  const asTradeSource = validated(parseTradeSource, "invalid trade source");

  return {
    tradeSubscribe: channel(asTradeSource, async (win, source) => {
      await requireEnabled();
      const id = win.webContents.id;
      if (!cleanupInstalled.has(id)) {
        cleanupInstalled.add(id);
        win.webContents.once("destroyed", () => {
          cleanupInstalled.delete(id);
          ctx.tradeChat.unsubscribe(id);
        });
      }
      return ctx.tradeChat.subscribe(id, source, (event) => {
        sendIfLive(win, IPC.tradeEvent, event);
      });
    }),

    tradeUnsubscribe: channel(nothing, (win) => {
      ctx.tradeChat.unsubscribe(win.webContents.id);
    }),

    tradeSavedGet: channel(nothing, async () => {
      await requireEnabled();
      return ctx.getTradeSaved();
    }),

    tradeSavedSet: channel(validated(parseTradeSavedState, "invalid trade saved state"), async (_win, value) => {
      await requireEnabled();
      return ctx.setTradeSaved(value);
    }),

    traderQuotesGet: channel(nothing, async () => {
      await requireEnabled();
      return ctx.tradeChat.getTraderQuotes();
    }),

    traderPriceHistoryGet: channel(
      validated(parseTraderPriceHistoryRequest, "invalid trader price history request"),
      async (_win, request) => {
        await requireEnabled();
        return ctx.tradeChat.getTraderPriceHistory(request);
      },
    ),

    tradeSearch: channel(
      validated(parseTradeSearchRequest, "invalid trade search request"),
      async (win, request) => {
        await requireEnabled();
        return ctx.tradeChat.search(
          win.webContents.id,
          request.source,
          request.query,
          request.scope,
        );
      },
    ),

    tradeRetry: channel(asTradeSource, async (win, source) => {
      await requireEnabled();
      ctx.tradeChat.retry(win.webContents.id, source);
    }),
  };
}
