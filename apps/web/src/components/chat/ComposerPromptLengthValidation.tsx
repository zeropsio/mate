import { Text } from "~/components/ui/text";

export function ComposerPromptLengthValidation({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <Text
      className="px-3 pb-2 sm:px-4"
      data-chat-composer-validation="prompt-length"
      render={<p />}
      role="alert"
      variant="error"
    >
      {message}
    </Text>
  );
}
