import { ApiProperty } from '@nestjs/swagger';

export class UserResponse {
  @ApiProperty({ format: 'uuid', description: 'Id nội bộ CodeMentor, không phải sub của Keycloak' })
  id!: string;

  @ApiProperty({ description: 'Keycloak subject (sub)' })
  keycloakUserId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ enum: ['STUDENT', 'LECTURER', 'ADMIN'], isArray: true })
  roles!: string[];
}
