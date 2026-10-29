import { judgeMessages, type TrialCase } from "./posterJudge.mts";
export function fewShotJudgeMessages(
  item: TrialCase,
  images: string[],
  basePrompt: string,
  teaching: any,
  teachingImages: string[][],
) {
  if (teaching.examples.some((e: any) => e.id === item.id))
    throw new Error("Teaching examples must not include the test poster");
  if (teaching.examples.length !== teachingImages.length)
    throw new Error("Teaching image count mismatch");
  const target = judgeMessages(item, images, basePrompt);
  const messages: any[] = [
    {
      role: "system",
      content:
        basePrompt +
        "\n\nVISUAL TEACHING EXAMPLES\n" +
        teaching.instructions +
        "\nThe example assistant responses demonstrate background geography only. For the final target, assess all three criteria and return the complete requested JSON schema.",
    },
  ];
  teaching.examples.forEach((example: any, index: number) => {
    if (teachingImages[index].length !== example.images.length)
      throw new Error("Teaching image count mismatch");
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            task: "worked_example",
            criterion: "background_geography",
            images: example.images.map(
              (image: any, i: number) => `image ${i + 1}: ${image.role}`,
            ),
          }),
        },
        ...teachingImages[index].map((url) => ({
          type: "image_url",
          image_url: { url, detail: "high" },
        })),
      ],
    });
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        criterion: "background_geography",
        verdict: example.expectedVerdict,
        summary: example.explanation,
      }),
    });
  });
  messages.push(target[1]);
  return messages;
}
