import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod.mjs';
import winston from 'winston';


const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'user-service' },
    transports: [
        new winston.transports.Console()
    ]
});


// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export interface ImagePromptPair {
    imageUrl: string;
    imageName: string;
    prompt: string;
    sceneDescription: string;
}

export interface VideoGenerationResult {
    selectedImages: ImagePromptPair[];
    narrationScript: string;
    totalDuration: number;
}


const PromptObject = z.object({
    image: z.string().url(),
    prompt: z.string()
});

const ResponseSchema = z.object({
    data: z.array(PromptObject),
    script: z.string()
});

class VideoPromptGenerator {

    /**
     * Main function to process images and generate video prompts
     */
    async generateVideoPrompts(
        reviewImages: string[],
        experienceImages: string[],
        name: string
    ): Promise<any> {

        // Step 1: Analyze and select best 10 images
        const selectedImages = await this.selectBestImages(experienceImages);


        // Step 2: Generate detailed prompts for each selected image

       const imagePromptPairs = await this.generatePromptsForImages(selectedImages, name);

        logger.info({
            imagePromptPairs
        })

        // Step 3: Create coherent narration script
        const narrationScript = await this.generateNarrationScript(imagePromptPairs)

        logger.info({
            narrationScript
        })

        return {
            selectedImages: imagePromptPairs,
            narrationScript,
            totalDuration: 50 // 10 images × 5 seconds each
        } 
    }

    /**
     * Select the best 10 images from the provided collection
     */
    private async selectBestImages(images: string[]): Promise<string[]> {
        

        logger.info(`Images $images`)

        if (images.length <= 10) {
            return images;
        }

        const prompt = `
You are an expert image curator for video creation. I have ${images.length} images that I want to use for a 50-second video (10 clips of 5 seconds each).

Please analyze these images and select the best 10 that would create:
1. A diverse and engaging visual story
2. Good variety in composition, lighting, and subject matter
3. Images that would work well for video generation
4. A logical flow from one scene to another

Consider factors like:
- Image quality and clarity
- Visual interest and composition
- Variety in scenes (avoid too many similar shots)
- Potential for creating dynamic video content
- Emotional impact and storytelling potential


RULE: Avoid images with people in them.

Return only the images in the order of preference, separated by commas. Use the exact image URL provided to return the image.

IMPORTANT: Return only the image URLs in the order of preference, separated by commas. Do not include any other text in your response.
FOLLOWING IS THE LIST OF IMAGES:
${images.map((img:string, index) => {
    return `${index + 1}. ${img}`
}).join('\n')}
`;

        try {
            
            console.log({
                images
            })

            const response = await openai.responses.create({
                model: "gpt-4o",
                input: [{
                    role: "user",
                    content: [
                        { type: "input_text", text: prompt },
                        ...images.map((img:string, index) => {
                            return {
                                type: "input_image" as const,
                                image_url: img,
                                detail: "high" as const
                            }
                        }),
                    ],
                }],
                text: {
                    format: zodTextFormat(z.object({
                        selectedImages: z.array(z.string())
                    }), "selectedImages"),
                },
            });
            

            console.log({
                response,
                output_text: response.output_text
            })
            
            const selectedImageNames = JSON.parse(response.output_text)?.selectedImages || [];
            


            logger.info({
                selectedImageNames
            })

            // Map back to original image URLs/paths
            return selectedImageNames.map((name: any) => {
                const found = images.find(img => img.includes(name) || name.includes(path.basename(img)));
                return found || images[parseInt(name) - 1] || name;
            }).filter(Boolean).slice(0, 10);



        } catch (error) {
            console.error('Error selecting images:', error);
            return images.slice(0, 10); // Fallback to first 10
        }
    }

    /**
     * Generate detailed video prompts for each image
     */
    private async generatePromptsForImages(images: string[], name: string): Promise<ImagePromptPair[]> {
        const results: ImagePromptPair[] = [];

        for (let i = 0; i < images.length; i++) {
            const imageUrl = images[i];
            const prompt = await this.generateSingleImagePrompt(imageUrl, i + 1, name);

            logger.info({
                prompt
            })

            results.push({
                imageUrl,
                imageName: path.basename(imageUrl),
                prompt: prompt.videoPrompt,
                sceneDescription: prompt.sceneDescription
            });
        }

        return results;
    }

    /**
     * Generate a detailed prompt for a single image
     */
    private async generateSingleImagePrompt(
        imageUrl: string,
        sequenceNumber: number,
        name: string
    ): Promise<any> {

        const prompt = `
You are an expert video director creating prompts for Luma's Dream Machine AI video model. 

For image ${sequenceNumber}/10 of experience ${name} in a 50-second video sequence, create a detailed video generation prompt that will transform this image into a cinematic 5-second video clip.
    
CRITICAL REQUIREMENTS:
- Keep ALL people/humans in the image completely STATIC and STILL - no human movement whatsoever
- Preserve the original image colors and quality - NO filters, NO stylistic changes
- Only use CAMERA MOVEMENT to create the video effect

Your prompt should include:

1. CAMERA MOVEMENT: Specify camera motion like "Slow zoom in", "Gentle pan left to right", "Orbit around subject", "Dolly forward", "Static shot with subtle movement"

2. VISUAL STYLE: Describe the aesthetic - "Cinematic lighting", "Golden hour glow", "Dramatic shadows", "Soft natural lighting", "Vibrant colors", "Film grain texture"

3. SCENE DYNAMICS: What should move or change - "Gentle breeze moving hair/clothes", "Subtle background activity", "Light shifts", "Natural ambient motion"

4. MOOD & ATMOSPHERE: "Peaceful and contemplative", "Energetic and dynamic", "Mysterious and moody", "Warm and inviting"

5. TECHNICAL DETAILS: "Shallow depth of field", "Wide angle shot", "Close-up detail", "Medium shot", "Establishing shot"

If the image has people in it, make sure we don't move the people or get too close to them.

Write in natural language as a conversation with the AI model. Be specific and descriptive.

Image context: This is image ${sequenceNumber} of 10 in a user experience/review video sequence.
`;

        try {
            const response = await openai.responses.create({
                model: "gpt-4o",
                input: [{
                    role: "user",
                    content: [
                        { type: "input_text", text: prompt },
                        {
                            type: "input_image",
                            image_url: imageUrl,
                            detail: "auto"
                        },
                    ],
                }],
                text: {
                    format: zodTextFormat(z.object({
                        videoPrompt: z.string(),
                        sceneDescription: z.string()
                    }), "videoPrompt"),
                },
            });

            try {
                const content = JSON.parse(response.output_text);

                logger.info({
                    content
                })
                return content;
            } catch (error) {
                console.error("Error parsing response:", error);
                return {
                    videoPrompt: `A cinematic shot with gentle camera movement and warm lighting, transforming this image into a beautiful 5-second video with natural motion and atmospheric depth.`,
                    sceneDescription: `Experience moment ${sequenceNumber}`
                };
            }

        } catch (error) {
            console.error(`Error generating prompt for image ${sequenceNumber}:`, error);
            return {
                videoPrompt: `A cinematic shot with gentle camera movement and warm lighting, transforming this image into a beautiful 5-second video with natural motion and atmospheric depth.`,
                sceneDescription: `Experience moment ${sequenceNumber}`
            };
        }
    }

    /**
     * Generate coherent narration script for the entire video
     */
    private async generateNarrationScript(imagePromptPairs: ImagePromptPair[]): Promise<string> {
        const sceneDescriptions = imagePromptPairs.map((pair, index) =>
            `Scene ${index + 1} (0:${String(index * 5).padStart(2, '0')}-0:${String((index + 1) * 5).padStart(2, '0')}): ${pair.sceneDescription}`
        ).join('\n');

        const prompt = `
Create a 50-second narration script that describes exactly what is shown in each scene based on the scene descriptions provided.

The video consists of 10 scenes, each 5 seconds long:
${sceneDescriptions}

Requirements:
1. Describe ONLY what is actually visible in each scene based on the scene descriptions
2. NO fun facts, NO additional information beyond what's described
3. Each section should be approximately 5 seconds of speaking time (8-10 words)
4. Use simple, clear descriptive language
5. Stay true to the scene descriptions provided
6. MUST END with "Book on Headout seamlessly now" in the final segment
7. Focus on visual elements and what viewers can see
8. Speak in a natural, conversational tone. Don't use personal pronouns like I, me, my, etc.
9. Do not include any other text in the script like [Scene 1] or [Scene 2] or [Scene 3] or [Scene 4] or [Scene 5] or [Scene 6] or [Scene 7] or [Scene 8] or [Scene 9] or [Scene 10]
10. Do not include any other special characters in the script
11. Total number of words should be 100-120
12. Put some pauses in the script to make it more natural, and don't use any special characters in the script


Script Structure:
- Each segment describes what's happening in that specific scene using engaging language
- Keep descriptions accurate to the scene descriptions
- Don't mention the image in the script
- End with the Headout booking call-to-action

`;

        try {
            const response = await openai.responses.parse({
                model: "gpt-4o",
                input: [{ role: "system", content: prompt }],
                text: {
                    format: zodTextFormat(z.object({
                        script: z.string()
                    }), "script"),
                },
            });

            logger.info({
                response
            })

            return response.output_parsed?.script || 'A beautiful journey of experiences, captured in moments that tell your unique story.';

        } catch (error) {
            console.error('Error generating narration script:', error);
            return 'A beautiful journey of experiences, captured in moments that tell your unique story.';
        }
    }

    /**
     * Export results to JSON format
     */
    exportToJSON(result: VideoGenerationResult): string {
        const output = {
            project: "Hackathon Video Generation",
            totalDuration: result.totalDuration,
            videoSegments: result.selectedImages.map((pair, index) => ({
                sequence: index + 1,
                startTime: index * 5,
                endTime: (index + 1) * 5,
                inputImage: pair.imageUrl,
                imageName: pair.imageName,
                videoPrompt: pair.prompt,
                sceneDescription: pair.sceneDescription
            })),
            narrationScript: result.narrationScript,
            metadata: {
                totalSegments: result.selectedImages.length,
                segmentDuration: 5,
                generatedAt: new Date().toISOString(),
                videoModel: "Luma Dream Machine"
            }
        };

        return JSON.stringify(output, null, 2);
    }
}

// Usage example
/* async function main() {
  const generator = new VideoPromptGenerator();
  
  // Example usage
  const reviewImages = [
    'path/to/review1.jpg',
    'path/to/review2.jpg',
    // ... more review images
  ];
  
  const experienceImages = [
    'path/to/experience1.jpg',
    'path/to/experience2.jpg',
    // ... more experience images
  ];

  try {
    console.log('Generating video prompts...');
    const result = await generator.generateVideoPrompts(reviewImages, experienceImages);
    
    const jsonOutput = generator.exportToJSON(result);
    console.log('Generated JSON:', jsonOutput);
    
    // Optionally save to file
    fs.writeFileSync('video_generation_output.json', jsonOutput);
    console.log('Results saved to video_generation_output.json');
    
  } catch (error) {
    console.error('Error in main process:', error);
  }
} */

// Export for use in other modules
export { VideoPromptGenerator };

