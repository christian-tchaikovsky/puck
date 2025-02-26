import { useEffect } from "react";
import { flattenData } from "../lib/flatten-data";
import { ComponentData, Config, Permissions, UserGenerics } from "../types";
import { getChanged } from "../lib/get-changed";
import { create } from "zustand";
import { getAppStore, useAppStore } from "../stores/app-store";

type PermissionsArgs<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
> = {
  item?: G["UserComponentData"] | null;
  type?: keyof G["UserProps"];
  root?: boolean;
};

export type GetPermissions<UserConfig extends Config = Config> = (
  params?: PermissionsArgs<UserConfig>
) => Permissions;

type ResolvePermissions<UserConfig extends Config = Config> = (
  params?: PermissionsArgs<UserConfig>,
  force?: boolean
) => void;

export type RefreshPermissions<UserConfig extends Config = Config> = (
  params?: PermissionsArgs<UserConfig>,
  force?: boolean
) => void;

type Cache = Record<
  string,
  {
    lastPermissions: Partial<Permissions>;
    lastData: ComponentData | null;
  }
>;

export const usePermissionsStore = create<{
  cache: Cache;
  globalPermissions: Permissions;
  resolvedPermissions: Record<string, Partial<Permissions> | undefined>;
  getPermissions: GetPermissions<Config>;
  resolvePermissions: ResolvePermissions<Config>;
}>((set, get) => ({
  cache: {},
  globalPermissions: {
    drag: true,
    edit: true,
    delete: true,
    duplicate: true,
    insert: true,
  },
  resolvedPermissions: {},
  getPermissions: ({ item, type, root } = {}) => {
    const { config } = getAppStore();
    const { globalPermissions, resolvedPermissions } = get();

    if (item) {
      const componentConfig = config.components[item.type];

      const initialPermissions = {
        ...globalPermissions,
        ...componentConfig?.permissions,
      };

      const resolvedForItem = resolvedPermissions[item.props.id];

      return (
        resolvedForItem
          ? { ...globalPermissions, ...resolvedForItem }
          : initialPermissions
      ) as Permissions;
    } else if (type) {
      const componentConfig = config.components[type];

      return {
        ...globalPermissions,
        ...componentConfig?.permissions,
      } as Permissions;
    } else if (root) {
      const rootConfig = config.root;

      const initialPermissions = {
        ...globalPermissions,
        ...rootConfig?.permissions,
      } as Permissions;

      const resolvedForItem = resolvedPermissions["puck-root"];

      return (
        resolvedForItem
          ? { ...globalPermissions, ...resolvedForItem }
          : initialPermissions
      ) as Permissions;
    }

    return globalPermissions;
  },
  resolvePermissions: async (params = {}, force) => {
    const { cache, globalPermissions } = get();
    const { state } = getAppStore<Config>();

    const resolveDataForItem = async (
      item: ComponentData,
      force: boolean = false
    ) => {
      const {
        config,
        state: appState,
        setComponentLoading,
        unsetComponentLoading,
      } = getAppStore<Config>();
      const componentConfig =
        item.type === "root" ? config.root : config.components[item.type];

      if (!componentConfig) {
        return;
      }

      const initialPermissions = {
        ...globalPermissions,
        ...componentConfig.permissions,
      };

      if (componentConfig.resolvePermissions) {
        const changed = getChanged(item, cache[item.props.id]?.lastData);

        if (Object.values(changed).some((el) => el === true) || force) {
          setComponentLoading(item.props.id);

          const resolvedPermissions = await componentConfig.resolvePermissions(
            item,
            {
              changed,
              lastPermissions: cache[item.props.id]?.lastPermissions || null,
              permissions: initialPermissions,
              appState,
              lastData: cache[item.props.id]?.lastData || null,
            }
          );

          const latest = get();

          set({
            cache: {
              ...latest.cache,
              [item.props.id]: {
                lastData: item,
                lastPermissions: resolvedPermissions,
              },
            },
            resolvedPermissions: {
              ...latest.resolvedPermissions,
              [item.props.id]: resolvedPermissions,
            },
          });

          unsetComponentLoading(item.props.id);
        }
      }
    };

    const resolveDataForRoot = (force = false) => {
      const { state: appState } = getAppStore();

      resolveDataForItem(
        // Shim the root data in by conforming to component data shape
        {
          type: "root",
          props: { ...appState.data.root.props, id: "puck-root" },
        },
        force
      );
    };

    const { item, type, root } = params;

    if (item) {
      // Resolve specific item
      await resolveDataForItem(item, force);
    } else if (type) {
      // Resolve specific type
      flattenData(state.data)
        .filter((item) => item.type === type)
        .map(async (item) => {
          await resolveDataForItem(item, force);
        });
    } else if (root) {
      resolveDataForRoot(force);
    } else {
      resolveDataForRoot(force);

      // Resolve everything
      flattenData(state.data).map(async (item) => {
        await resolveDataForItem(item, force);
      });
    }
  },
}));

export const useRegisterPermissionsStore = (
  globalPermissions: Partial<Permissions>
) => {
  useEffect(() => {
    const { globalPermissions: existingGlobalPermissions } =
      usePermissionsStore.getState();
    usePermissionsStore.setState({
      globalPermissions: {
        ...existingGlobalPermissions,
        ...globalPermissions,
      } as Permissions,
    });

    usePermissionsStore.getState().resolvePermissions();
  }, [globalPermissions]);

  useEffect(() => {
    return useAppStore.subscribe(
      (s) => s.state.data,
      () => {
        usePermissionsStore.getState().resolvePermissions();
      }
    );
  }, []);

  useEffect(() => {
    return useAppStore.subscribe(
      (s) => s.config,
      () => {
        usePermissionsStore.getState().resolvePermissions();
      }
    );
  }, []);
};
