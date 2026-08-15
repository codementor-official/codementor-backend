import { ApiProperty } from '@nestjs/swagger';

const ROLES = ['learner', 'lecturer', 'admin'] as const;

export class UserResponse {
  @ApiProperty({ format: 'uuid', description: 'Id nội bộ CodeMentor, không phải sub của Keycloak' })
  id!: string;

  @ApiProperty({ description: 'Do Keycloak sở hữu — không sửa được qua API này' })
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ nullable: true, description: 'Định danh trong URL công khai (@giasi)' })
  handle!: string | null;

  @ApiProperty({ enum: ROLES, description: 'Do realm role của Keycloak quyết định' })
  role!: (typeof ROLES)[number];

  @ApiProperty({ nullable: true })
  bio!: string | null;

  @ApiProperty({ nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ nullable: true })
  websiteUrl!: string | null;

  @ApiProperty({ nullable: true })
  githubHandle!: string | null;

  @ApiProperty({ example: 'vi' })
  locale!: string;

  @ApiProperty({ example: 'Asia/Ho_Chi_Minh' })
  timezone!: string;

  @ApiProperty()
  emailVerified!: boolean;
}
