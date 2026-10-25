import { SUPPORTED_ASPECT_RATIOS } from '../core/aspect-ratio.mjs';
import { templateDocumentSchema } from '../template-library.mjs';
import { API_VERSION } from '../core/command-catalog.mjs';
import { FORMAT, FORMAT_VERSION, captionSchema } from '../core/project.mjs';

// Closed MCP result contracts; transport and command dispatch stay in the adapter.
const text = { type: 'string' };
const record = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const occurrenceProperties = {
  occurrenceIndex: {type: 'integer', minimum: 0, maximum: 9999},
  captionIndex: {type: 'integer', minimum: 0, maximum: 9999},
  clipIndex: {type: 'integer', minimum: 0, maximum: 999},
  start: {type: 'number', minimum: 0}, end: {type: 'number', minimum: 0},
};
function captionReviewSchema() {
  const count = {type: 'integer', minimum: 0, maximum: 10000};
  const findingCount = {type: 'integer', minimum: 0, maximum: 40000};
  const positive = {type: 'number', exclusiveMinimum: 0};
  const issue = (kind, evidence, optional = []) => record({
    kind: {enum: [kind]}, ...occurrenceProperties, ...evidence,
  }, ['kind', 'occurrenceIndex', 'captionIndex', 'start', 'end', ...Object.keys(evidence).filter(key => !optional.includes(key))]);
  return record({
    metric: {enum: ['caption-review']},
    thresholds: record({maxGraphemesPerSecond: positive, minDuration: positive, maxDuration: positive,
      includeOverlaps: {type: 'boolean'}}, ['includeOverlaps']),
    filter: {enum: ['all', 'reading-speed', 'too-short', 'too-long', 'overlap']},
    totalOccurrences: count, flaggedOccurrences: count,
    counts: record({readingSpeed: count, tooShort: count, tooLong: count, overlap: count}),
    totalFindings: findingCount, matchedFindings: findingCount, omittedFindings: findingCount,
    issues: {type: 'array', maxItems: 100, items: {anyOf: [
      issue('reading-speed', {graphemeCount: {type: 'integer', minimum: 0, maximum: 2000},
        graphemesPerSecond: {type: 'number', minimum: 0}}),
      issue('too-short', {duration: positive}), issue('too-long', {duration: positive}),
      issue('overlap', {
        otherOccurrenceIndex: {type: 'integer', minimum: 0, maximum: 9999},
        otherCaptionIndex: {type: 'integer', minimum: 0, maximum: 9999},
        otherClipIndex: {type: 'integer', minimum: 0, maximum: 999},
        otherStart: {type: 'number', minimum: 0}, otherEnd: {type: 'number', minimum: 0},
        overlapStart: {type: 'number', minimum: 0}, overlapEnd: {type: 'number', minimum: 0},
      }, ['otherClipIndex']),
    ]}},
  });
}
const documentSchema = record({
  format: { enum: [FORMAT] },
  formatVersion: { enum: [FORMAT_VERSION] },
  project: {
    type: 'object',
    description: 'Complete project state; retain fields not involved in the requested edit.'
  },
});
const mediaReference = {
  type: ['object', 'null'],
  properties: {
    name: text,
    required: { enum: [true] }
  },
  required: ['name', 'required'],
  additionalProperties: false,
};

function dataSchema(command) {
  switch (command) {
    case 'timeline.move': return record({
      updated: { type: 'boolean' },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'project.preview': {
      const summary = record({
        clipCount: { type: 'integer', minimum: 1, maximum: 1000 },
        captionCount: { type: 'integer', minimum: 0, maximum: 10000 },
        cardCount: { type: 'integer', minimum: 0, maximum: 12 },
        outputDuration: { type: 'number', minimum: 0 }
      });
      return record({
        operationCount: { type: 'integer', minimum: 1, maximum: 20 },
        wouldCommit: { type: 'boolean' },
        changedFields: {
          type: 'array',
          maxItems: 100,
          uniqueItems: true,
          items: { type: 'string', maxLength: 100 }
        },
        before: summary,
        after: structuredClone(summary)
      });
    }
    case 'project.batch': return record({
      updated: { type: 'boolean' },
      operationCount: { type: 'integer', minimum: 1, maximum: 20 },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'project.get': return documentSchema;
    case 'project.summary': return record({
      kind: { enum: ['demo', 'video'] },
      ratio: { enum: [...SUPPORTED_ASPECT_RATIOS] },
      speed: { type: 'number', minimum: .25, maximum: 4 },
      sourceDuration: { type: 'number', minimum: .001, maximum: 86400 },
      timelineDuration: {
        type: 'number',
        minimum: 0,
        description: 'Edited seconds BEFORE speed, using the existing project duration calculation.'
      },
      outputDuration: {
        type: 'number',
        minimum: 0,
        description: 'Edited seconds AFTER speed; not an encoded media duration measurement.'
      },
      clipCount: { type: 'integer', minimum: 1, maximum: 1000 },
      captionCount: { type: 'integer', minimum: 0, maximum: 10000 },
      cardCount: { type: 'integer', minimum: 0, maximum: 12 },
      media: record({
        requiresVideo: {
          type: 'boolean',
          description: 'Saved project kind is video. Does not assert that a file is loaded or available.'
        },
        requiresAudio: {
          type: 'boolean',
          description: 'Saved audioName is nonempty. Does not assert that a file is loaded or available.'
        },
      }),
    });
    case 'template.inspect': {
      const timing = {
        enabled: { type: 'boolean' },
        start: { type: 'number', minimum: 0 },
        end: { type: ['number', 'null'], minimum: 0 }
      };
      return record({
        template: record({
          id: text,
          name: text,
          category: text,
          tag: text,
          description: text,
          flow: { type: 'array', items: text },
          exampleTitle: { type: 'array', minItems: 2, maxItems: 2, items: text },
          reference: {
            type: ['object', 'null'],
            properties: { title: text, url: text },
            required: ['title', 'url'],
            additionalProperties: false
          }
        }),
        withContent: { type: 'boolean' },
        outputDuration: { type: 'number', minimum: 0 },
        title: record({
          lines: { type: 'array', minItems: 2, maxItems: 2, items: text },
          ...timing
        }),
        credit: record({ text, ...timing }),
        cards: {
          type: 'array',
          maxItems: 12,
          items: record({
            index: { type: 'integer', minimum: 0, maximum: 11 },
            role: { enum: ['headline', 'free'] },
            text,
            detail: text,
            label: text,
            enabled: { type: 'boolean' },
            start: { type: 'number', minimum: 0 },
            end: { type: 'number', minimum: 0 }
          })
        }
      });
    }
    case 'template.export': return templateDocumentSchema();
    case 'project.import': return record({
      imported: { enum: [true] }
    });
    case 'templates.list': return {
      type: 'array',
      items: record({ id: text, name: text, category: text, description: text }),
    };
    case 'captions.insert':
    case 'captions.remove': return record({
      updated: { const: true },
      captionIndex: { type: 'integer', minimum: 0, maximum: 9999 },
      totalCaptions: { type: 'integer', minimum: 0, maximum: 10000 },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'captions.update': return record({
      updated: { const: true },
      captionIndex: { type: 'integer', minimum: 0, maximum: 9999 },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'captions.split.long': return record({
      updated: { type: 'boolean' },
      changedCaptions: { type: 'integer', minimum: 0, maximum: 10000 },
      addedCaptions: { type: 'integer', minimum: 0, maximum: 9999 },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'captions.split': return record({
      updated: { const: true },
      createdCaptionIndex: { type: 'integer', minimum: 1, maximum: 9999 },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'captions.merge': return record({
      updated: { const: true },
      mergedCaptionIndex: { type: 'integer', minimum: 0, maximum: 9998 },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'captions.speaker.assign': return record({
      updated: { type: 'boolean' },
      changedCaptions: { type: 'integer', minimum: 0, maximum: 10000 },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'captions.timing.shift': return record({
      updated: { type: 'boolean' },
      shiftedCaptions: { type: 'integer', minimum: 0, maximum: 10000 },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'captions.text.replace': return record({
      updated: { type: 'boolean' },
      matches: { type: 'integer', minimum: 0 },
      changedCaptions: { type: 'integer', minimum: 0, maximum: 10000 },
    });
    case 'overlays.move': return record({
      updated: { type: 'boolean' },
      id: { type: 'string', minLength: 1, maxLength: 2000 },
      toIndex: { type: 'integer', minimum: 0, maximum: 11 },
      outputDuration: { type: 'number', minimum: 0 }
    });
    case 'overlays.add':
    case 'overlays.remove': return record({
      updated: { enum: [true] },
      outputDuration: { type: 'number', minimum: 0 },
      id: { type: 'string', minLength: 1, maxLength: 2000 }
    });
    case 'captions.import': return record({
      updated: { enum: [true] },
      importedCaptions: { type: 'integer', minimum: 1, maximum: 10000 },
      outputDuration: { type: 'number', minimum: 0 },
    });
    case 'timeline.list': return record({
      totalClips: { type: 'integer', minimum: 1, maximum: 1000 },
      offset: { type: 'integer', minimum: 0, maximum: 1000 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      nextOffset: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
      speed: { type: 'number', minimum: .25, maximum: 4 },
      clips: {
        type: 'array',
        maxItems: 50,
        items: record({
          clipIndex: { type: 'integer', minimum: 0, maximum: 999 },
          sourceStart: { type: 'number', minimum: 0, maximum: 86400 },
          sourceEnd: { type: 'number', minimum: 0, maximum: 86400 },
          timelineStart: { type: 'number', minimum: 0 },
          timelineEnd: { type: 'number', minimum: 0 },
          outputStart: { type: 'number', minimum: 0 },
          outputEnd: { type: 'number', minimum: 0 }
        })
      },
    });
    case 'captions.list': return record({
      totalCaptions: { type: 'integer', minimum: 0, maximum: 10000 },
      offset: { type: 'integer', minimum: 0, maximum: 10000 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      nextOffset: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
      captions: {
        type: 'array',
        maxItems: 50,
        items: record({
          captionIndex: { type: 'integer', minimum: 0, maximum: 9999 },
          caption: structuredClone(captionSchema)
        })
      },
    });
    case 'captions.overlaps': return record({
      metric: { const: 'output-time-overlap' },
      totalOccurrences: { type: 'integer', minimum: 0, maximum: 10000 },
      flaggedOccurrences: { type: 'integer', minimum: 0, maximum: 10000 },
      omittedOccurrences: { type: 'integer', minimum: 0, maximum: 10000 },
      issues: {
        type: 'array',
        maxItems: 100,
        items: record({
          occurrenceIndex: { type: 'integer', minimum: 0, maximum: 9999 },
          captionIndex: { type: 'integer', minimum: 0, maximum: 9999 },
          clipIndex: { type: 'integer', minimum: 0, maximum: 999 },
          start: { type: 'number', minimum: 0 },
          end: { type: 'number', minimum: 0 },
          otherOccurrenceIndex: { type: 'integer', minimum: 0, maximum: 9999 },
          otherCaptionIndex: { type: 'integer', minimum: 0, maximum: 9999 },
          otherClipIndex: { type: 'integer', minimum: 0, maximum: 999 },
          otherStart: { type: 'number', minimum: 0 },
          otherEnd: { type: 'number', minimum: 0 },
          overlapStart: { type: 'number', minimum: 0 },
          overlapEnd: { type: 'number', minimum: 0 },
        }, [
          'occurrenceIndex', 'captionIndex', 'start', 'end', 'otherOccurrenceIndex',
          'otherCaptionIndex', 'otherStart', 'otherEnd', 'overlapStart', 'overlapEnd'
        ])
      },
    });
    case 'captions.inspect': return { anyOf: [
      record({
      metric: { enum: ['non-whitespace-graphemes-per-second'] },
      maxGraphemesPerSecond: { type: 'number', exclusiveMinimum: 0 },
      totalOccurrences: { type: 'integer', minimum: 0, maximum: 10000 },
      flaggedOccurrences: { type: 'integer', minimum: 0, maximum: 10000 },
      omittedOccurrences: { type: 'integer', minimum: 0, maximum: 10000 },
      issues: {
        type: 'array',
        maxItems: 100,
        items: record({
          occurrenceIndex: { type: 'integer', minimum: 0, maximum: 9999 },
          captionIndex: { type: 'integer', minimum: 0, maximum: 9999 },
          clipIndex: { type: 'integer', minimum: 0, maximum: 999 },
          start: { type: 'number', minimum: 0 },
          end: { type: 'number', minimum: 0 },
          graphemeCount: { type: 'integer', minimum: 0, maximum: 2000 },
          graphemesPerSecond: { type: 'number', minimum: 0 },
        }, ['occurrenceIndex', 'captionIndex', 'start', 'end', 'graphemeCount', 'graphemesPerSecond'])
      },
    }),
      captionReviewSchema(),
    ] };
    case 'captions.export': return record({
      format: { enum: ['srt', 'vtt', 'txt'] },
      text: {
        type: 'string',
        description: 'SRT/WebVTT uses final output seconds; TXT defaults to literal edited cue paragraphs without timestamps; review:true adds output times and assigned speaker names. Repeated or cut cues may repeat text. Save this string, not the result envelope.',
      }
    });
    case 'render.plan': return record({
      planVersion: { enum: [1] },
      project: documentSchema,
      output: record({
        width: { type: 'number', minimum: 1 },
        height: { type: 'number', minimum: 1 },
        fps: { enum: [30] },
        format: { enum: ['mp4', 'webm'] },
        duration: { type: 'number', minimum: 0 },
      }),
      media: record({ video: mediaReference, audio: mediaReference }),
      rendered: { enum: [false], description: 'A plan is metadata, not an encoded video or downloadable artifact.' },
    });
    default: return record({
      updated: { enum: [true] },
      outputDuration: {
        type: 'number',
        minimum: 0,
        description: 'Total edited duration in output seconds, after speed.',
      }
    });
  }
}

export function outputSchema(command) {
  const common = {
    apiVersion: { enum: [API_VERSION] },
    command: { enum: [command] }
  };
  return {
    type: 'object',
    description: 'The structuredContent envelope. Check ok before reading data; validation failures do not apply edits.',
    oneOf: [
      record({ ok: { enum: [true] }, ...common, data: dataSchema(command) }),
      record({
        ok: { enum: [false] },
        ...common,
        error: record({
          code: text,
          message: text,
          path: { type: 'string', description: 'Optional invalid input field path.' },
        }, ['code', 'message'])
      }),
    ],
  };
}
