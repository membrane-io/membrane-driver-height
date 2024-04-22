/**
 * Driver for height.app
 *
 * See the [Height API docs](https://height.notion.site/API-documentation-643aea5bf01742de9232e5971cb4afda) for more information.
 */
import { root, state, values, handles, resolvers, nodes } from "membrane";

/**
 * Task events will contain a data attribute with a [task object](https://height.notion.site/The-task-object-d8dff420ddbe4afc8837f493e922be7b) as model.
 * Activity events will contain a data attribute with a activity object as model.
 * @see https://height.notion.site/Webhook-event-types-f35f375f41854241820522da30ad81b7
 */
const WebhookEvents = [
  "task.created",
  "task.updated",
  "task.deleted",
  "activity.created",
  "activity.updated",
  "activity.deleted",
] as const;

/**
 * @see https://height.notion.site/Webhook-event-types-f35f375f41854241820522da30ad81b7
 */
type WebhookEvent = (typeof WebhookEvents)[number];

export type State = {
  token?: string;
  webhooks: Record<WebhookEvent, { id: string; refs: number }>;
};
state.webhooks ??= {} as State["webhooks"];

type Options = Omit<RequestInit, "body"> & { body?: object };
type ExtraOptions = Omit<Options, "method" | "body">;
const api = <T>(route: string, options?: Options): Promise<T> =>
  fetch(`https://api.height.app/${route}`, {
    ...options,
    method: options?.method ?? "GET",
    body: options?.body ? JSON.stringify(options.body) : undefined,
    headers: {
      ...options?.headers,
      ["content-type"]: "application/json",
      Authorization: `api-key ${state.token}`,
    },
  }).then((r) => r.json());

api.post = <T>(route: string, body?: object, options?: ExtraOptions) =>
  api<T>(route, { method: "POST", body, ...options });
api.patch = <T>(route: string, body?: object, options?: ExtraOptions) =>
  api<T>(route, { method: "PATCH", body, ...options });
api.delete = <T>(route: string, body?: object, options?: ExtraOptions) =>
  api<T>(route, { method: "DELETE", body, ...options });

const pageParams = (args: { page?: number; pageSize?: number }) => {
  return {
    page: Math.max(args.page ?? 1, 1),
    pageSize: Math.min(25, args.pageSize ?? 10),
  };
};
const paginate = <T>(self: any, items: T[], page: number, pageSize: number) => {
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize);
  return {
    items: pageItems,
    next: pageItems.length === pageSize ? self.page({ page: page + 1 }) : null,
  };
};

export const status: resolvers.Root["status"] = () => {
  return !state.token ? "[Add API Token](:configure)" : "Ready";
};

export const configure: resolvers.Root["configure"] = async ({ token }) => {
  state.token = token;
};

export function workspace() {
  return api("workspace");
}

export function me() {
  return api("users/me");
}

export const lists = () => ({});
export const users = () => ({});
export const tasks = () => ({});

export const taskCreated: resolvers.Root["taskCreated"] = {
  subscribe() {
    return ensureWebhook(["task.created"]);
  },
  unsubscribe() {
    return removeWebhook(["task.created"]);
  },
};

export const taskUpdated: resolvers.Root["taskUpdated"] = {
  subscribe() {
    return ensureWebhook(["task.updated"]);
  },
  unsubscribe() {
    return removeWebhook(["task.updated"]);
  },
};

export const taskDeleted: resolvers.Root["taskDeleted"] = {
  subscribe() {
    return ensureWebhook(["task.deleted"]);
  },
  unsubscribe() {
    return removeWebhook(["task.deleted"]);
  },
};

export const TaskList: resolvers.TaskList = {
  gref(_, { obj }) {
    return root.lists.one({ id: obj.id });
  },
  async update(args, { self }) {
    const id = await self.id.$get();
    const { icon, iconHue, ...otherArgs } = args;
    const list = await api.patch(`lists/${id}`, {
      appearance: { icon, iconHue },
      ...otherArgs,
    });
    return list;
  },
  async duplicate(args: { name?: string } = {}, { self }) {
    const id = await self.id.$get();
    return await api.post(`lists/${id}/duplicate`, args);
  },
};

export const TaskListCollection: resolvers.TaskListCollection = {
  async one({ id }) {
    const { list: items } = await api<{ list: values.TaskList[] }>("lists");
    return items.find((list) => list.id === id)!;
  },

  async page(args, { self }) {
    const { page, pageSize } = pageParams(args);
    const { list: items } = await api<{ list: values.TaskList[] }>("lists");
    return paginate(self, items, page, pageSize);
  },
};

export const Task: resolvers.Task = {
  gref(_, { obj }) {
    return root.tasks.one({ id: obj.id });
  },
  parentTask(_, { obj }) {
    return TaskCollection.one!({ id: obj.parentTaskId }, {} as any);
  },
  async postComment({ message }, { self }) {
    let { id: taskId } = self.$argsAt(root.tasks.one)!;

    // The API only accepts UUIDs for task IDs, so we need to resolve the task ID if it's an index
    if (isTaskIndex(taskId)) {
      taskId = await self.id.$get();
    }

    const { id } = await api.post<{ id: string }>(`activities`, {
      type: "comment",
      message,
      taskId,
    });
    return root.activities.one({ id });
  },
  onActivity: {
    subscribe() {
      return ensureWebhook([
        "activity.created",
        "activity.updated",
        "activity.deleted",
      ]);
    },
    unsubscribe() {
      return removeWebhook([
        "activity.created",
        "activity.updated",
        "activity.deleted",
      ]);
    },
  },
  onUpdated: {
    subscribe() {
      return ensureWebhook(["task.updated"]);
    },
    unsubscribe() {
      return removeWebhook(["task.updated"]);
    },
  },
  onDeleted: {
    subscribe() {
      return ensureWebhook(["task.deleted"]);
    },
    unsubscribe() {
      return removeWebhook(["task.deleted"]);
    },
  },
};

export const TaskCollection: resolvers.TaskCollection = {
  one: ({ id }) => api(`tasks/${id}`),
  async page(args, { self }) {
    const { page, pageSize } = pageParams(args);
    const { list } = await api<{ list: object[] }>(
      `tasks?filters={"deleted":{"values":[false]}}`
    );
    return paginate(self, list, page, pageSize);
  },
};

export const User: resolvers.User = {
  gref(_, { obj }) {
    return root.users.one({ id: obj.id });
  },
};

export const UserCollection: resolvers.UserCollection = {
  one: ({ id }) => api(`users/${id}`),
  async page(args, { self }) {
    const { page, pageSize } = pageParams(args);
    const { list } = await api<{ list: unknown[] }>("users");

    return paginate(self, list, page, pageSize);
  },
};

export const Activity: resolvers.Activity = {
  gref(_, { obj }) {
    return root.activities.one({ id: obj.id });
  },
  createdUser(_, { obj }) {
    return UserCollection.one!({ id: obj.createdUserId }, {} as any);
  },
};

export const ActivityCollection: resolvers.ActivityCollection = {
  async one({ id }, { self }) {
    const { taskId } = self.$argsAt(root.activities)!;
    const { list } = await api<{ list: { id: string }[] }>(
      `activities?taskId=${taskId}`
    );
    return list.find((activity) => activity.id === id);
  },
  async page(args, { self }) {
    const { taskId } = self.$argsAt(root.activities)!;
    const { page, pageSize } = pageParams(args);
    const { list } = await api<{ list: unknown[] }>(
      `activities?taskId=${taskId}`
    );
    return paginate(self, list, page, pageSize);
  },
};

/**
 * @see https://height.notion.site/The-webhook-object-a65788ae2c404d21a4e999f83f1a7fb9
 */
interface Webhook extends values.Webhook {
  /** The unique id of the webhook event */
  id: string;
  model: "webhookEvent";
  /**
   * The webhook event type. See all event types here:
   * https://height.notion.site/Webhook-event-types-f35f375f41854241820522da30ad81b7
   */
  events: WebhookEvent[];
}

/**
 * @see https://height.notion.site/The-webhook-event-object-c7c1d75c072e41d5bf5ca072c6e35a57
 */
interface WebhookPayload {
  id: string;
  model: "webhookEvent";
  webhookId: string;
  type: WebhookEvent;
  data: {
    model: Record<string, any>;
    previousModule?: Record<string, any>;
  };
}

export const Webhook: resolvers.Webhook = {
  gref(_, { obj }) {
    return root.webhooks.one({ id: obj.id });
  },
};

export const WebhookCollection: resolvers.WebhookCollection = {
  async one({ id }) {
    const { list: webhooks } = await api<{ list: Webhook[] }>(`webhooks`);
    return webhooks.find((webhook: Webhook) => webhook.id === id);
  },
  async page(args, { self }) {
    const { page, pageSize } = pageParams(args);
    const { list } = await api<{ list: Webhook[] }>("webhooks");
    return paginate(self, list, page, pageSize);
  },
};

async function ensureWebhook(webhookEvents: WebhookEvent[]) {
  const events = new Set(webhookEvents);
  const { list: webhookList } = await api<{ list: Webhook[] }>("webhooks");

  for (const event of events) {
    if (state.webhooks[event]) {
      const webhook = webhookList.find(
        (webhook) => webhook.id === state.webhooks[event].id
      );

      if (webhook) {
        state.webhooks[event].refs++;
        continue;
      }
      delete state.webhooks[event];
    }

    const webhook = await api.post<Webhook>("webhooks", {
      url: (await nodes.process.endpointUrl) + "/webhook",
      events: [event],
    });
    state.webhooks[event] = { id: webhook.id, refs: 1 };
  }
}

async function removeWebhook(webhookEvents: WebhookEvent[]) {
  const events = new Set(webhookEvents);
  const { list: webhookList } = await api<{ list: Webhook[] }>("webhooks");

  for (const event of events) {
    const webhookRef = state.webhooks[event];
    if (webhookRef) {
      if (webhookRef.refs > 1) {
        webhookRef.refs--;
        continue;
      }
      if (webhookRef.refs === 1) {
        const webhook = webhookList.find(
          (webhook) => webhook.id === webhookRef.id
        );
        if (webhook) {
          await api.delete(`webhooks/${webhook.id}`);
        }
        delete state.webhooks[event];
      }
    }
  }
}

export const endpoint: resolvers.Root["endpoint"] = async ({
  method,
  body,
  path,
}) => {
  if (method === "POST" && path === "/webhook") {
    const webhook: WebhookPayload = JSON.parse(body ?? "");
    switch (webhook.type) {
      case "task.created":
        const issue = root.tasks.one({ id: webhook.data.model.id });
        return root.taskCreated().$emit(issue);
      case "task.updated":
        return Promise.all([
          root.taskUpdated().$emit(webhook.data.model.id),
          root.tasks.one({ id: webhook.data.model.id }).onUpdated().$emit(),
        ]);
      case "task.deleted":
        return Promise.all([
          root.taskDeleted().$emit(webhook.data.model.id),
          root.tasks.one({ id: webhook.data.model.id }).onDeleted().$emit(),
        ]);
      case "activity.created":
      case "activity.updated":
      case "activity.deleted":
        console.log("activity event", webhook.type);
        return root.tasks
          .one({ id: webhook.data.model.taskId })
          .onActivity()
          .$emit();
    }
  }
};

/**
 * Returns `true` if the given string is a series of numbers
 * Height tasks are either index numbers or UUIDs, this is a simple way to differentiate between the two.
 **/
function isTaskIndex(id: string): boolean {
  return /^\d+$/.test(id);
}
