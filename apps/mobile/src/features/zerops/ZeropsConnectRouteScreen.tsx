import { StackActions, useNavigation } from "@react-navigation/native";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import {
  resolveMateVisibility,
  type RoleMateVisibility,
} from "@t3tools/client-runtime/zerops/mateAccess";
import type { CandidatesNotice } from "@t3tools/client-runtime/zerops/projections";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { ZeropsMark } from "../../components/ZeropsMark";
import { StatusDot } from "../../components/zerops";
import { connectZeropsIdentity } from "../../connection/onboarding";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { uuidv4 } from "../../lib/uuid";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectionSheetButton } from "../connection/ConnectionSheetButton";
import { useSetHomeEnvironmentId } from "../home/home-list-options";
import { candidatePickerBody, type MobileCandidate } from "./candidate-listing";
import { zeropsErrorMessage } from "./errors";
import { exchangeZeropsContainerIdentity } from "./identity-exchange";
import {
  CANDIDATE_SECTION_LABELS,
  CANDIDATE_SECTIONS,
  zeropsCandidatePresentation,
  type ZeropsCandidatePresentation,
} from "./presentation";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsSession } from "./ZeropsSessionProvider";

type ZeropsConnectSurfaceProps = {
  readonly onDone: (environmentId: EnvironmentId) => void;
  readonly onOpenPairing: () => void;
};

function CandidateRow(props: {
  readonly candidate: MobileCandidate;
  readonly presentation: ZeropsCandidatePresentation;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { presentation } = props;
  return (
    <View className="gap-3 rounded-[18px] bg-card px-4 py-4">
      <View className="flex-row items-start justify-between gap-4">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-t3-bold text-base text-foreground" numberOfLines={2}>
            {props.candidate.project.name}
          </Text>
          <Text className="text-sm text-foreground-muted" numberOfLines={2}>
            {props.candidate.service?.name ?? "Zerops project"}
          </Text>
        </View>
        <StatusDot
          label={presentation.label}
          tone={presentation.tone}
          state={presentation.pulsing ? "pulsing" : "steady"}
        />
      </View>

      {presentation.notice ? (
        <Text className="text-sm leading-normal text-foreground-muted">{presentation.notice}</Text>
      ) : null}

      {presentation.action ? (
        <ConnectionSheetButton
          compact
          disabled={props.disabled}
          icon={presentation.section === "connected" ? "arrow.right.circle" : "link"}
          label={props.busy ? "Connecting..." : presentation.action}
          tone={presentation.section === "ready" ? "primary" : "secondary"}
          onPress={props.onPress}
        />
      ) : null}
    </View>
  );
}

function SignedOutSurface(props: { readonly onOpenPairing: () => void }) {
  const { restoreError, retryRestore, signIn } = useZeropsSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(zeropsErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [email, password, signIn]);

  return (
    <View className="gap-5">
      <View className="items-center gap-3 py-3">
        <ZeropsMark height={44} />
        <View className="items-center gap-1.5">
          <Text className="font-t3-bold text-xl text-foreground">Sign in to Zerops</Text>
          <Text className="text-center text-sm leading-normal text-foreground-muted">
            Choose a Zerops Mate project and connect this device without entering a code.
          </Text>
        </View>
      </View>

      <View className="gap-4 rounded-[24px] bg-card p-4">
        {restoreError ? (
          <View className="gap-3 rounded-[16px] bg-subtle p-3">
            <ErrorBanner message="We couldn't restore your Zerops session. You can retry or sign in again." />
            <ConnectionSheetButton
              compact
              icon="arrow.clockwise"
              label="Retry session restore"
              tone="secondary"
              onPress={retryRestore}
            />
          </View>
        ) : null}
        <View className="gap-1.5">
          <Text className="text-2xs font-t3-bold uppercase tracking-[0.8px] text-foreground-muted">
            Email
          </Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
          />
        </View>
        <View className="gap-1.5">
          <Text className="text-2xs font-t3-bold uppercase tracking-[0.8px] text-foreground-muted">
            Password
          </Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="current-password"
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => {
              if (!busy && email.trim() && password) void submit();
            }}
          />
        </View>
        {error ? <ErrorBanner message={error} /> : null}
        <ConnectionSheetButton
          disabled={busy || !email.trim() || !password}
          icon="person.crop.circle"
          label={busy ? "Signing in..." : "Sign in"}
          tone="primary"
          onPress={() => void submit()}
        />
      </View>

      <ConnectionSheetButton
        icon="link"
        label="Connect with a one-time link"
        tone="secondary"
        onPress={props.onOpenPairing}
      />
    </View>
  );
}

function TotpSurface() {
  const { verifyTotp, signOut } = useZeropsSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(code);
    } catch (cause) {
      setError(zeropsErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [code, verifyTotp]);

  return (
    <View className="gap-5">
      <View className="items-center gap-3 py-3">
        <ZeropsMark height={44} />
        <Text className="font-t3-bold text-xl text-foreground">Two-factor authentication</Text>
        <Text className="text-center text-sm leading-normal text-foreground-muted">
          Enter the current code from your authenticator app.
        </Text>
      </View>
      <View className="gap-4 rounded-[24px] bg-card p-4">
        <TextInput
          autoComplete="one-time-code"
          autoFocus
          keyboardType="number-pad"
          maxLength={8}
          placeholder="123456"
          textContentType="oneTimeCode"
          value={code}
          onChangeText={setCode}
          onSubmitEditing={() => {
            if (!busy && code.trim()) void submit();
          }}
        />
        {error ? <ErrorBanner message={error} /> : null}
        <ConnectionSheetButton
          disabled={busy || !code.trim()}
          icon="checkmark.circle"
          label={busy ? "Verifying..." : "Verify code"}
          tone="primary"
          onPress={() => void submit()}
        />
        <ConnectionSheetButton
          compact
          disabled={busy}
          icon="chevron.left"
          label="Start over"
          tone="secondary"
          onPress={() => void signOut()}
        />
      </View>
    </View>
  );
}

/**
 * What the listing says in place of a "none" it may not say yet (§3.4): a placeholder while it is
 * read, the cause and one retry when its read failed, "Still reading…" over a partial one.
 */
function ListingNotice(props: { readonly notice: CandidatesNotice; readonly onRetry: () => void }) {
  const { message, affordance, region } = props.notice;
  const retry =
    affordance !== null &&
    (affordance.kind === "retry" ||
      affordance.kind === "retry-now" ||
      affordance.kind === "renew-access")
      ? affordance
      : null;
  return (
    <View className="items-center gap-3 py-6">
      {region === "placeholder" ? <ActivityIndicator size="large" /> : null}
      <Text className="text-center text-sm leading-normal text-foreground-muted">
        {message.text}
      </Text>
      {retry === null ? null : (
        <ConnectionSheetButton
          compact
          icon="arrow.clockwise"
          label={retry.label}
          tone="secondary"
          onPress={props.onRetry}
        />
      )}
    </View>
  );
}

function ProjectPickerSurface(props: { readonly onDone: (environmentId: EnvironmentId) => void }) {
  const { client, user, signOut, newRecoveryToken, clearNewRecoveryToken } = useZeropsSession();
  const { listing, readAtMs, error, refresh } = useZeropsCandidates();
  const connect = useAtomCommand(connectZeropsIdentity, { reportFailure: false });
  const connectingRef = useRef(false);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const isConnecting = connectingKey !== null;
  const visibleError = actionError ?? error;
  const body = useMemo(() => candidatePickerBody(listing, readAtMs), [listing, readAtMs]);
  // What this person may do with each Mate, from the one role function the
  // door runs too (D5). Undefined when nobody is signed in to judge by.
  const viewerOrganization = user?.clientUserList?.[0];
  const visibilityOf = useCallback(
    (candidate: MobileCandidate): RoleMateVisibility | undefined => {
      const organizationId = viewerOrganization?.clientId;
      if (viewerOrganization === undefined || organizationId === undefined) return undefined;
      return resolveMateVisibility({
        project: candidate.project,
        viewer: {
          id: organizationId,
          membershipId: viewerOrganization.id,
          roleCode: viewerOrganization.roleCode,
          canCreateProjects: viewerOrganization.canCreateProjects,
        },
      });
    },
    [viewerOrganization],
  );
  const sections = useMemo(() => {
    if (body.kind !== "rows") return [];
    const presented = body.rows.map((candidate) => {
      const visibility = visibilityOf(candidate);
      return {
        candidate,
        presentation: zeropsCandidatePresentation(
          candidate,
          visibility === undefined ? {} : { visibility },
        ),
      };
    });
    return CANDIDATE_SECTIONS.map((section) => ({
      section,
      rows: presented.filter((row) => row.presentation.section === section),
    })).filter((section) => section.rows.length > 0);
  }, [body, visibilityOf]);

  const openCandidate = useCallback(
    async (candidate: MobileCandidate) => {
      if (connectingRef.current) return;
      if (candidate.group === "connected" && candidate.environmentId) {
        props.onDone(candidate.environmentId);
        return;
      }
      if (visibilityOf(candidate) === "listed") return;
      if (
        candidate.group !== "ready" ||
        candidate.container.level !== "ready" ||
        !candidate.containerOrigin
      ) {
        return;
      }
      connectingRef.current = true;
      setConnectingKey(candidate.key);
      setActionError(null);
      try {
        // The token is minted in the org that owns the Mate's project.
        const clientId = candidate.project.clientId;
        const result = await exchangeZeropsContainerIdentity({
          containerOrigin: candidate.containerOrigin,
          throwaway:
            client.session?.accessToken && clientId
              ? {
                  platform: zeropsThrowawayPlatform(client),
                  clientId,
                  projectId: candidate.project.id,
                  nonce: uuidv4(),
                }
              : null,
          connect,
        });
        if (result._tag === "Failure") {
          setActionError(result.error);
          return;
        }
        props.onDone(result.environmentId);
      } catch (cause) {
        setActionError(zeropsErrorMessage(cause));
      } finally {
        connectingRef.current = false;
        setConnectingKey(null);
      }
    },
    [client, connect, props, visibilityOf],
  );

  return (
    <View className="gap-5">
      {newRecoveryToken ? (
        <View className="gap-3 rounded-[20px] bg-card px-4 py-4">
          <View className="gap-1.5">
            <Text className="font-t3-bold text-base text-foreground">
              Save your new recovery code
            </Text>
            <Text className="text-sm leading-normal text-foreground-muted">
              Your previous recovery code was used. Save this replacement now; it is shown only
              once.
            </Text>
          </View>
          <Text
            className="rounded-[12px] bg-subtle px-3 py-3 font-t3-bold text-base tracking-[0.8px] text-foreground"
            selectable
          >
            {newRecoveryToken}
          </Text>
          <ConnectionSheetButton
            compact
            icon="checkmark.circle"
            label="I saved this code"
            tone="primary"
            onPress={clearNewRecoveryToken}
          />
        </View>
      ) : null}
      <View className="gap-3 rounded-[20px] bg-card px-4 py-4">
        <View className="flex-row items-center gap-3">
          <ZeropsMark height={30} />
          <View className="min-w-0 flex-1">
            <Text className="font-t3-bold text-base text-foreground">Zerops account</Text>
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              {user?.email ?? "Signed in"}
            </Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <View className="flex-1">
            <ConnectionSheetButton
              compact
              disabled={isConnecting}
              icon="arrow.clockwise"
              label="Refresh"
              tone="secondary"
              onPress={refresh}
            />
          </View>
          <View className="flex-1">
            <ConnectionSheetButton
              compact
              disabled={isConnecting}
              icon="person.crop.circle"
              label="Sign out"
              tone="secondary"
              onPress={() => void signOut()}
            />
          </View>
        </View>
      </View>

      {visibleError ? <ErrorBanner message={visibleError} /> : null}

      {body.kind === "notice" ? (
        <ListingNotice notice={body} onRetry={refresh} />
      ) : body.kind === "none" ? (
        visibleError ? null : (
          <View className="items-center gap-2 rounded-[20px] bg-card px-5 py-8">
            <Text className="font-t3-bold text-base text-foreground">No projects found</Text>
            <Text className="text-center text-sm leading-normal text-foreground-muted">
              This account has no Zerops Mate container available yet.
            </Text>
          </View>
        )
      ) : (
        <>
          {sections.map(({ section, rows }) => (
            <View className="gap-2.5" key={section}>
              <Text className="px-1 text-2xs font-t3-bold uppercase tracking-[0.8px] text-foreground-muted">
                {CANDIDATE_SECTION_LABELS[section]}
              </Text>
              {rows.map(({ candidate, presentation }) => (
                <CandidateRow
                  busy={connectingKey === candidate.key}
                  candidate={candidate}
                  disabled={isConnecting}
                  key={candidate.key}
                  presentation={presentation}
                  onPress={() => void openCandidate(candidate)}
                />
              ))}
            </View>
          ))}
          {body.notice === null ? null : <ListingNotice notice={body.notice} onRetry={refresh} />}
        </>
      )}
    </View>
  );
}

function ZeropsConnectSurface(props: ZeropsConnectSurfaceProps) {
  const { status } = useZeropsSession();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  return (
    <View className="flex-1 bg-sheet">
      <NativeStackScreenOptions
        options={{
          ...(Platform.OS === "android" ? { headerShown: false } : null),
          title: status === "signed-in" ? "Choose project" : "Connect with Zerops",
        }}
      />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title={status === "signed-in" ? "Choose project" : "Connect with Zerops"}
          onBack={() => navigation.goBack()}
        />
      ) : null}
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
      >
        {status === "loading" ? (
          <View className="items-center gap-3 py-12">
            <ActivityIndicator size="large" />
            <Text className="text-sm text-foreground-muted">Checking your Zerops session...</Text>
          </View>
        ) : status === "signed-out" ? (
          <SignedOutSurface onOpenPairing={props.onOpenPairing} />
        ) : status === "totp-required" ? (
          <TotpSurface />
        ) : (
          <ProjectPickerSurface onDone={props.onDone} />
        )}
      </ScrollView>
    </View>
  );
}

export function ZeropsConnectRouteScreen() {
  const navigation = useNavigation();
  const setHomeEnvironmentId = useSetHomeEnvironmentId();
  return (
    <ZeropsConnectSurface
      onDone={(environmentId) => {
        setHomeEnvironmentId(environmentId);
        navigation.dispatch(StackActions.replace("Home"));
      }}
      onOpenPairing={() => navigation.navigate("ConnectionsPairing")}
    />
  );
}

export function SettingsZeropsConnectRouteScreen() {
  const navigation = useNavigation();
  const setHomeEnvironmentId = useSetHomeEnvironmentId();
  return (
    <ZeropsConnectSurface
      onDone={(environmentId) => {
        setHomeEnvironmentId(environmentId);
        navigation.navigate("Home");
      }}
      onOpenPairing={() =>
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: { screen: "SettingsEnvironmentPairing" },
        })
      }
    />
  );
}
