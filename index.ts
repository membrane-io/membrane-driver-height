/**
 * Driver for height.app
 *
 * See the [Height API docs](https://height.notion.site/API-documentation-643aea5bf01742de9232e5971cb4afda) for more information.
 */
import { root, state, values, handles, resolvers } from "membrane";

export type State = {
  token?: string;
};

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

export const TaskList: resolvers.TaskList = {
  gref(_, { obj }) {
    return root.lists.one({ id: obj.id });
  },
  async patch(args, { self }) {
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
  async comment({ message }, { self }) {
    const { id: taskId } = self.$argsAt(root.tasks.one)!;
    const { id } = await api.post<{ id: string }>(`activities`, {
      type: "comment",
      message,
      taskId,
    });
    return root.activities.one({ id });
  },
};

export const TaskCollection: resolvers.TaskCollection = {
  one: ({ id }) => api(`tasks/${id}`),
  async page(args, { self }) {
    const filters = {
      deleted: { values: [false] },
      ...(args.listId && { listIds: { values: [args.listId] } }),
    };

    const params = new URLSearchParams({ filters: JSON.stringify(filters) });
    const { page, pageSize } = pageParams(args);
    const { list } = await api<{ list: object[] }>(`tasks?${params}`);
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
