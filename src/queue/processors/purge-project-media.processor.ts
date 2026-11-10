import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProfessionalProjectsService } from '../../modules/professional-projects/professional-projects.service';
import { PURGE_PROJECT_MEDIA_QUEUE } from '../queue.constants';

export interface PurgeProjectMediaJobData {
  projectId: string;
}

@Processor(PURGE_PROJECT_MEDIA_QUEUE)
export class PurgeProjectMediaProcessor extends WorkerHost {
  private readonly logger = new Logger(PurgeProjectMediaProcessor.name);

  constructor(
    @Inject(forwardRef(() => ProfessionalProjectsService))
    private readonly projectsService: ProfessionalProjectsService,
  ) {
    super();
  }

  async process(job: Job<PurgeProjectMediaJobData>) {
    const { projectId } = job.data;
    try {
      await this.projectsService.purgeProjectMedia(projectId);
      this.logger.log(`Purged media for removed project ${projectId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Purge project media failed for ${projectId}: ${message}`,
      );
      throw error;
    }
  }
}
