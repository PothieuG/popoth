import { z } from 'zod'

export const processStep1BodySchema = z.object({
  context: z.enum(['profile', 'group']),
})

export type ProcessStep1Body = z.infer<typeof processStep1BodySchema>
